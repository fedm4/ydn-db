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
 * @fileoverview Provide iteration query.
 *
 * @author kyawtun@yathit.com (Kyaw Tun)
 */

goog.provide('ydn.db.index.Storage');
goog.require('ydn.db.index.TxQueue');
goog.require('ydn.db.core.Storage');


/**
 * Construct storage providing atomic CRUD database operations on implemented
 * storage mechanisms.
 *
 * This class do not execute database operation, but create a non-overlapping
 * transaction queue on ydn.db.core.TxQueue and all operations are
 * passed to it.
 *
 *
 * @param {string=} opt_dbname database name.
 * @param {(!ydn.db.schema.Database|!DatabaseSchema)=} opt_schema database
 * schema
 * or its configuration in JSON format. If not provided, default empty schema
 * is used.
 * @param {!StorageOptions=} opt_options options.
 * @extends {ydn.db.core.Storage}
 * @implements {ydn.db.index.IStorage}
 * @constructor
 */
ydn.db.index.Storage = function(opt_dbname, opt_schema, opt_options) {

  goog.base(this, opt_dbname, opt_schema, opt_options);

};
goog.inherits(ydn.db.index.Storage, ydn.db.core.Storage);


/**
 * @override
 */
ydn.db.index.Storage.prototype.newTxQueue = function(scope_name, blocked) {
  return new ydn.db.index.TxQueue(this, !!blocked, this.ptx_no++, scope_name,
    this.schema);
};


/**
 *
 * @param {!ydn.db.Iterator} iterator the cursor.
 * @param {Function} callback icursor handler.
 * @param {ydn.db.base.TransactionMode=} mode mode.
 * @return {!goog.async.Deferred} promise on completed.
 */
ydn.db.index.Storage.prototype.open = function(iterator, callback, mode) {
  return this.base_tx_queue.open(iterator, callback, mode);
};


/**
 * Cursor scan iteration.
 * @param {!Array.<!ydn.db.Iterator>} iterators the cursor.
 * @param {!ydn.db.algo.AbstractSolver|function(!Array, !Array): !Array} solver
 * solver.
 * @param {!Array.<!ydn.db.Streamer>=} streamers streamers.
 * @return {!goog.async.Deferred} promise on completed.
 */
ydn.db.index.Storage.prototype.scan = function(iterators, solver, streamers) {
  return this.base_tx_queue.scan(iterators, solver, streamers);
};


///**
// * Explain query plan.
// * @param {!ydn.db.Iterator} q
// * @return {Object} plan in JSON
// */
//ydn.db.index.Storage.prototype.explain = function(q) {
//  return this.base_tx_queue.explain(q);
//};


/**
 *
 * @param {!ydn.db.Iterator} iterator
 * @param {function(*): (*|undefined)} callback
 */
ydn.db.index.Storage.prototype.map = function (iterator, callback) {
  return this.base_tx_queue.map(iterator, callback);
};


/**
 *
 * @param {!ydn.db.Iterator} iterator
 * @param {function(*, *, number): *} callback
 * @param {*=} initial
 */
ydn.db.index.Storage.prototype.reduce = function(iterator, callback, initial) {
  return this.base_tx_queue.reduce(iterator, callback, initial);
};

