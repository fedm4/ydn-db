/**
 * @fileoverview JsTestDriver test unit for ydn.store.Storage.
 */

goog.provide('ydn.db.test.CrudJstest');
goog.require('goog.debug.Console');
goog.require('goog.debug.LogManager');
goog.require('ydn.db.Storage');
goog.require('ydn.db.test');


var database_options = window.database_options || undefined;


ydn.db.test.CrudJstest = AsyncTestCase('ydn.db.test.CrudJstest');

ydn.db.test.CrudJstest.prototype.setUp = function() {


};


ydn.db.test.CrudJstest.prototype.tearDown = function() {

};


ydn.db.test.CrudJstest.prototype.testAddFail = function(queue) {
  var schema = {
    stores: [{
      name: 'st',
      keyPath: 'id'
    }]
  };
  var db = new ydn.db.Storage('testAddFail', schema, database_options);
  var key = Math.random();
  db.put('st', {id: key, value: '1'});
  queue.call('add', function(callbacks) {
    var req = db.add('st', {id: key, value: '2', remark: 'add test'});
    req.addCallbacks(callbacks.addErrback('can add again'), callbacks.add(function(e2) {
      assertEquals('constraint error', 'ConstraintError', e2.name);
      ydn.db.deleteDatabase(db.getName(), db.getType());
      db.close();
    }));
  });

};


ydn.db.test.CrudJstest.prototype.testClearStore = function(queue) {
  var schema = {
    stores: [{
      name: 'st',
      keyPath: 'id'
    }, {
      name: 'st2',
      keyPath: 'id'
    }, {
      name: 'st3',
      keyPath: 'id'
    }]
  };
  var db = new ydn.db.Storage('testClearStore', schema, database_options);
  var key = Math.random();
  db.put('st', [{id: 1}, {id: 2}]);
  queue.call('clear single', function(callbacks) {
    db.get('st', 1).addBoth(callbacks.add(function(x) {
      assertEquals('get object 1', 1, x.id);
    }));
    db.clear('st').addBoth(callbacks.add(function(cnt) {
      assertEquals('#store', 1, cnt);
    }));
    db.get('st', 1).addBoth(callbacks.add(function(x) {
      assertUndefined('cleared', x);
    }));
  });

  queue.call('clear multiple', function(callbacks) {
    db.clear(['st2', 'st3']).addBoth(callbacks.add(function(cnt) {
      assertEquals('#store', 2, cnt);
    }));
  });

  queue.call('clear all', function(callbacks) {
    db.clear().addBoth(callbacks.add(function(cnt) {
      assertEquals('#store', 3, cnt);
      ydn.db.deleteDatabase(db.getName(), db.getType());
      db.close();
    }));
  });

};




