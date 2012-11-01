/**
 * @license Copyright 2012 YDN Authors, Yathit. All Rights Reserved.
 */
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


/**
 * @fileoverview Generic database connector.
 *
 * Create and maintain database connection and provide robust transaction
 * objects upon request. Storage mechanism providers implement
 * ydn.db.con.IDatabase interface.
 *
 * @author kyawtun@yathit.com (Kyaw Tun)
 */

goog.provide('ydn.db.con.Storage');
goog.require('goog.userAgent.product');
goog.require('ydn.async');
goog.require('ydn.db.con.LocalStorage');
goog.require('ydn.db.con.SessionStorage');
goog.require('ydn.db.con.IndexedDb');
goog.require('ydn.db.con.SimpleStorage');
goog.require('ydn.db.con.WebSql');
goog.require('ydn.db.schema.EditableDatabase');
goog.require('ydn.object');
goog.require('ydn.error.ArgumentException');
goog.require('ydn.db.con.IStorage');
goog.require('ydn.db.events.StorageEvent');
goog.require('goog.events.EventTarget');



/**
 * Create a suitable storage mechanism.
 *
 * If database name and schema are provided, this will immediately initialize
 * the database and ready to use. However if any of these two are missing,
 * the database is not initialize until they are set by calling
 * {@link #setsetDbName} and {@link #setSchema}.
 * @see goog.db Google Closure Library DB module.
 * @param {string=} opt_dbname database name.
 * @param {!ydn.db.schema.Database|DatabaseSchema=} opt_schema database schema
 * or its configuration in JSON format. If not provided, default empty schema
 * is used.
 * schema used in chronical order.
 * @param {!StorageOptions=} opt_options options.
 * @implements {ydn.db.con.IStorage}
 * @constructor
 * @extends {goog.events.EventTarget}
 */
ydn.db.con.Storage = function(opt_dbname, opt_schema, opt_options) {

  goog.base(this);

  var options = opt_options || {};

  /**
   * @final
   * @type {!Array.<string>}
   */
  this.mechanisms = options.Mechanisms || ydn.db.con.Storage.PREFERENCE;

  /**
   * @final
   * @type {number|undefined}
   */
  this.size = options.size;

  /**
   * @final
   * @type {boolean}
   */
  this.use_text_store = goog.isDef(options.use_text_store) ?
    options.use_text_store : ydn.db.base.ENABLE_DEFAULT_TEXT_STORE;

  /**
   * @type {ydn.db.con.IDatabase}
   * @private
   */
  this.db_ = null;

  /**
   * Transaction queue
   * @private
   * @final
   * @type {!Array.<{fnc: Function, scopes: Array.<string>,
   * mode: ydn.db.base.TransactionMode, oncompleted: Function}>}
   */
  this.txQueue_ = [];

  this.in_version_change_tx_ = false;

  var schema;
  if (opt_schema instanceof ydn.db.schema.Database) {
    schema = opt_schema;
  } else if (goog.isObject(opt_schema)) {
    if (options.autoSchema || !goog.isDef(opt_schema['Stores'])) {
      schema = new ydn.db.schema.EditableDatabase(opt_schema);
    } else {
      schema = new ydn.db.schema.Database(opt_schema);
    }
  } else {
    schema = new ydn.db.schema.EditableDatabase();
  }

  /**
   * @final
   * @protected
   * @type {!ydn.db.schema.Database}
   */
  this.schema = schema;


  if (goog.isDef(opt_dbname)) {
    this.setName(opt_dbname);
  }
};
goog.inherits(ydn.db.con.Storage, goog.events.EventTarget);


/**
 * @protected
 * @type {goog.debug.Logger} logger.
 */
ydn.db.con.Storage.prototype.logger =
  goog.debug.Logger.getLogger('ydn.db.con.Storage');
//
//
//
///**
// * Get configuration of this storage. This is useful from getting storage from
// * main thread to worker thread.
// * <pre>
// *   var db = new ydn.db.con.Storage(...);
// *   ... initialize ...
// *   var config = db.getConfig();
// *
// *   ... in worker thread ...
// *   var worker_db = new ydn.db.con.Storage(config.db_name, config.schema);
// * </pre>
// * In this way, data can be share between the two threads.
// *
// * @return {{name: string, schema: DatabaseSchema}?} configuration
// * containing database and list of schema in JSON format.
// * @export
// * @deprecated
// */
//ydn.db.con.Storage.prototype.getConfig = function() {
//  if (!this.schema) {
//    return null;
//  }
//
//  return {
//    'name': this.db_name,
//    'schema': this.getSchema()
//  };
//};


/**
 * Get current schema.
 * @param {function(ydn.db.schema.Database)=} opt_callback
 * @return {DatabaseSchema}
 */
ydn.db.con.Storage.prototype.getSchema = function(opt_callback) {
  if (goog.isDef(opt_callback)) {
    var callback = function(schema) {
      opt_callback(schema.toJSON());
    };
    if (this.db_) {
      this.db_.getSchema(callback);
    } else {
      var me = this;
      goog.asserts.assertFunction(callback); // compiler complained.
      var get_schema = function(tx) {
        me.db_.getSchema(callback, tx);
      };
      this.transaction(get_schema, null, ydn.db.base.TransactionMode.READ_ONLY);
    }
  }
  return this.schema ? /** @type {!DatabaseSchema} */ (this.schema.toJSON()) : null;
};


/**
 * Get current schema.
 * @return {StoreSchema?} null if give store do not exist
 */
ydn.db.con.Storage.prototype.getStoreSchema = function(store_name) {
  var store = this.schema.getStore(store_name);
  return store ? /** @type {!StoreSchema} */ (store.toJSON()) : null;
};


/**
 * Add a store schema to current database schema on auto schema generation
 * mode {@see #auto_schema}.
 * If the store already exist it will be updated as necessary.
 * @param {!StoreSchema|!ydn.db.schema.Store} store_schema
 * @return {!goog.async.Deferred}
 */
ydn.db.con.Storage.prototype.addStoreSchema = function (store_schema) {

  /**
   *
   * @type {ydn.db.schema.Store}
   */
  var new_store = store_schema instanceof ydn.db.schema.Store ?
      store_schema : ydn.db.schema.Store.fromJSON(store_schema);

  var store_name = store_schema.name;
  var store = this.schema.getStore(store_name);
  if (!new_store.similar(store)) {

    var action = store ? 'update' : 'add';

    if (this.schema instanceof ydn.db.schema.EditableDatabase) {
      // do update
      var schema = /** @type {ydn.db.schema.EditableDatabase} */ (this.schema);
      schema.addStore(new_store);
      if (this.db_) {
        this.db_.close();
        this.db_ = null;
        return this.connectDatabase();
      } else {
        return goog.async.Deferred.succeed(false);
      }
    } else {
      throw new ydn.error.ConstrainError('Cannot ' + action + ' store: ' +
        store_name + '. Not auto schema generation mode.');
    }
  } else {
    return goog.async.Deferred.succeed(false); // no change required
  }
};


/**
 * Set database name. This will initialize the database.
 * @export
 * @throws {Error} name already defined.
 * @param {string} opt_db_name set database name.
 */
ydn.db.con.Storage.prototype.setName = function(opt_db_name) {
  if (this.db_) {
    throw Error('Already defined.');
  }

  /**
   * @final
   * @protected
   * @type {string}
   */
  this.db_name = opt_db_name;
  this.connectDatabase();

};


/**
 * Super class must not mutate schema data.
 * @type {!ydn.db.schema.Database} database schema as requested.
 */
ydn.db.con.Storage.prototype.schema;


/**
 *
 * @return {string}
 */
ydn.db.con.Storage.prototype.getName = function() {
  return this.db_name;
};



/**
 * Specified storage mechanism ordering.
 * The default represent
 * IndexedDB, WebSql, localStorage and in-memory store.
 * @const
 * @type {!Array.<string>}
 */
ydn.db.con.Storage.PREFERENCE = [
  ydn.db.con.IndexedDb.TYPE,
  ydn.db.con.WebSql.TYPE,
  ydn.db.con.LocalStorage.TYPE,
  ydn.db.con.SessionStorage.TYPE,
  ydn.db.con.SimpleStorage.TYPE];


/**
 * Create database instance.
 * @protected
 * @param {string} db_type
 * @return {ydn.db.con.IDatabase}
 */
ydn.db.con.Storage.prototype.createDbInstance = function(db_type) {

  if (db_type == ydn.db.con.IndexedDb.TYPE) {
    return new ydn.db.con.IndexedDb(this.size);
  } else if (db_type == ydn.db.con.WebSql.TYPE) {
    return new ydn.db.con.WebSql(this.size);
  } else if (db_type == ydn.db.con.LocalStorage.TYPE) {
    return new ydn.db.con.LocalStorage();
  } else if (db_type == ydn.db.con.SessionStorage.TYPE) {
    return new ydn.db.con.SessionStorage();
  } else if (db_type == ydn.db.con.SimpleStorage.TYPE)  {
    return new ydn.db.con.SimpleStorage();
  }
  return null;
};


/**
 * Initialize suitable database if {@code dbname} and {@code schema} are set,
 * starting in the following order of preference.
 * @protected
 * @return {!goog.async.Deferred}
 */
ydn.db.con.Storage.prototype.connectDatabase = function () {
  // handle version change

  goog.asserts.assertString(this.db_name);

  var df = new goog.async.Deferred();

  /**
   * The connected database instance.
   * @type {ydn.db.con.IDatabase}
   */
  var db = null;

  if (goog.userAgent.product.ASSUME_CHROME ||
    goog.userAgent.product.ASSUME_FIREFOX) {
    // for dead-code elimination
    db = this.createDbInstance(ydn.db.con.IndexedDb.TYPE);
  } else if (goog.userAgent.product.ASSUME_SAFARI) {
    // for dead-code elimination
    db = this.createDbInstance(ydn.db.con.WebSql.TYPE);
  } else {
    // go according to ordering
    var preference = this.mechanisms;
    for (var i = 0; i < preference.length; i++) {
      var db_type = preference[i].toLowerCase();
      if (db_type == ydn.db.con.IndexedDb.TYPE && ydn.db.con.IndexedDb.isSupported()) { // run-time detection
        db = this.createDbInstance(db_type);
        break;
      } else if (db_type == ydn.db.con.WebSql.TYPE && ydn.db.con.WebSql.isSupported()) {
        db = this.createDbInstance(db_type);
        break;
      } else if (db_type == ydn.db.con.LocalStorage.TYPE && ydn.db.con.LocalStorage.isSupported()) {
        db = this.createDbInstance(db_type);
        break;
      } else if (db_type == ydn.db.con.SessionStorage.TYPE && ydn.db.con.SessionStorage.isSupported()) {
        db = this.createDbInstance(db_type);
        break;
      } else if (db_type == ydn.db.con.SimpleStorage.TYPE) {
        db = this.createDbInstance(db_type);
        break;
      }
    }
  }

  if (goog.isNull(db)) {
    // TODO: use fail event
    throw new ydn.error.ConstrainError('No storage mechanism found.');
  }

  var me = this;

  this.init(); // let super class to initialize.

  db.connect(this.db_name, this.schema).addCallback(function(ok) {
    me.db_ = db;
    me.logger.finest(me + ': ready.');
    me.last_queue_checkin_ = NaN;

    goog.async.Deferred.succeed(true);

    me.popTxQueue_();
    var event = new ydn.db.events.StorageEvent(ydn.db.events.Types.CONNECTED,
      me, null);
    me.dispatchEvent(event);

    /**
     *
     * @param e
     */
    db.onDisconnected = function (e) {

      me.logger.finest(me + ': disconnected.');
      // no event for disconnected.

    };
  }).addErrback(function(e) {
      me.logger.warning(me + ': opening fail: ' + e.message);
      goog.async.Deferred.fail(e);
      // this could happen if user do not allow to use the storage
      me.purgeTxQueue_(e);
      var event = new ydn.db.events.StorageEvent(ydn.db.events.Types.FAIL, me,
        e, 'opening database fail: ' + e.message);
      me.dispatchEvent(event);
    });

  return df;

};



/**
 *
 * @return {string}
 * @export
 */
ydn.db.con.Storage.prototype.type = function() {
  if (this.db_) {
    return this.db_.type();
  } else {
    return '';
  }
};


/**
 *
 * @return {boolean}
 */
ydn.db.con.Storage.prototype.isReady = function() {
  return !!this.db_ && this.db_.isReady();
};

//
///**
// *
// * @enum {string}
// */
//ydn.db.con.Storage.EventTypes = {
//  CONNECTED: 'conneted',
//  FAIL: 'fail',
//  CREATED: 'created',
//  UPDATED: 'updated',
//  DELETED: 'deleted'
//};




/**
 * Database database is instantiated, but may not ready.
 * Subclass may perform initialization.
 * When ready, deferred call are invoked and transaction queue
 * will run.
 * @protected
 */
ydn.db.con.Storage.prototype.init = function() {
};


/**
 * Close the database.
 * @export
 */
ydn.db.con.Storage.prototype.close = function() {
  if (this.db_) {
    this.db_.close();
    this.db_ = null;
  }
};

//
//
///**
// * Access readied database instance asynchronously.
// * @param {function(!ydn.db.con.IDatabase)} callback
// * @export
// */
//ydn.db.con.Storage.prototype.onReady = function(callback) {
//  if (this.db_ && !this.db_.getDbInstance()) {
//    // we can skip this check, but it saves one function wrap.
//    callback(this.db_);
//  } else {
//    this.deferredDb_.addCallback(callback);
//  }
//};


/**
 * Get database instance.
 * @protected
 * @return {ydn.db.con.IDatabase}
 */
ydn.db.con.Storage.prototype.getDb = function() {
  return this.db_;
};



/**
 * Get database instance.
 * @see {@link #getDb}
 * @return {*}
 */
ydn.db.con.Storage.prototype.getDbInstance = function() {
  return this.db_ ? this.db_.getDbInstance() : null;
};


/**
 *
 * @type {number}
 * @private
 */
ydn.db.con.Storage.prototype.last_queue_checkin_ = NaN;


/**
 * @const
 * @type {number}
 */
ydn.db.con.Storage.timeOut = goog.DEBUG || ydn.db.con.IndexedDb.DEBUG ?
  500 : 3000;


/**
 * @const
 * @type {number}
 */
ydn.db.con.Storage.MAX_QUEUE = 1000;


/**
 * Run the first transaction task in the queue. DB must be ready to do the
 * transaction.
 * @private
 */
ydn.db.con.Storage.prototype.popTxQueue_ = function() {

  var task = this.txQueue_.shift();
  if (task) {
    ydn.db.con.Storage.prototype.transaction.call(this,
      task.fnc, task.scopes, task.mode, task.oncompleted);
  }
  this.last_queue_checkin_ = goog.now();
};


/**
 * Push a transaction job to the queue.
 * @param {Function} trFn function that invoke in the transaction.
 * @param {Array.<string>} store_names list of keys or
 * store name involved in the transaction.
 * @param {ydn.db.base.TransactionMode=} opt_mode mode, default to 'readonly'.
 * @param {function(ydn.db.base.TransactionEventTypes, *)=} completed_event_handler
 * @private
 */
ydn.db.con.Storage.prototype.pushTxQueue_ = function (trFn, store_names,
    opt_mode, completed_event_handler) {
  this.txQueue_.push({
    fnc:trFn,
    scopes:store_names,
    mode:opt_mode,
    oncompleted:completed_event_handler
  });
  var now = goog.now();
  //if (!isNaN(this.last_queue_checkin_)) {
    //if ((now - this.last_queue_checkin_) > ydn.db.con.Storage.timeOut) {
    //  this.logger.warning('queue is not moving.');
      // todo: actively push the queue if transaction object is available
      // this will make robustness to the app.
      // in normal situation, queue will automatically empty since
      // pop queue will call whenever transaction is finished.
    //}
  //}
  if (this.txQueue_.length > ydn.db.con.Storage.MAX_QUEUE) {
    this.logger.warning('Maximum queue size exceed, dropping the first job.');
    this.txQueue_.shift();
  }

};


/**
 * Abort the queuing tasks.
 * @protected
 * @param e
 */
ydn.db.con.Storage.prototype.purgeTxQueue_ = function(e) {
  if (this.txQueue_) {
    this.logger.info('Purging ' + this.txQueue_.length +
      ' transactions request.');
    var task = this.txQueue_.shift();
    while (task) {
      task.oncompleted(ydn.db.base.TransactionEventTypes.ERROR, e);
      task = this.txQueue_.shift();
    }
  }
};


/**
 * Flag to indicate on version change transaction.
 * @type {boolean}
 * @private
 */
ydn.db.con.Storage.prototype.in_version_change_tx_ = false;



/**
 * Run a transaction.
 *
 * @param {Function} trFn function that invoke in the transaction.
 * @param {Array.<string>} store_names list of keys or
 * store name involved in the transaction.
 * @param {ydn.db.base.TransactionMode=} opt_mode mode, default to 'readonly'.
 * @param {function(ydn.db.base.TransactionEventTypes, *)=} completed_event_handler
 * @export
 * @final
 */
ydn.db.con.Storage.prototype.transaction = function (trFn, store_names, opt_mode, completed_event_handler) {

  var names = store_names;

  if (goog.isString(store_names)) {
    names = [store_names];
  } else if (!goog.isDefAndNotNull(store_names)) {
    names = null;
  } else if (!goog.isArray(store_names) ||
    (!goog.isString(store_names[0]))) {
    throw new ydn.error.ArgumentException("storeNames");
  }

  var is_ready = !!this.db_ && this.db_.isReady();
  if (!is_ready || this.in_version_change_tx_) {
    // a "versionchange" transaction is still running, a InvalidStateError
    // exception will be thrown
    this.pushTxQueue_(trFn, names, opt_mode, completed_event_handler);
    return;
  }

  var me = this;

  var mode = goog.isDef(opt_mode) ? opt_mode : ydn.db.base.TransactionMode.READ_ONLY;

  if (mode == ydn.db.base.TransactionMode.VERSION_CHANGE) {
    this.in_version_change_tx_ = true;
  }

  var on_complete = function (type, ev) {
    if (goog.isFunction(completed_event_handler)) {
      completed_event_handler(type, ev);
    }
    if (mode == ydn.db.base.TransactionMode.VERSION_CHANGE) {
      me.in_version_change_tx_ = false;
    }
    me.popTxQueue_();
  };

  //console.log('core running ' + trFn.name);
  this.db_.doTransaction(function (tx) {
    trFn(tx);
  }, names, mode, on_complete);

};


/**
 *
 * @return {boolean}
 */
ydn.db.con.Storage.prototype.isAutoVersion = function() {
  return this.schema.isAutoVersion();
};

/**
 *
 * @return {boolean}
 */
ydn.db.con.Storage.prototype.isAutoSchema = function() {
  return this.schema.isAutoSchema();
};


ydn.db.con.Storage.prototype.toString = function() {
  return 'ydn.db.con.Storage:' + this.db_;
};