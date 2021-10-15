/**
 * LokiJS
 * @author Joe Minichino <joe.minichino@gmail.com>
 *
 * A lightweight document oriented javascript database
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD
    define([], factory);
  } else if (typeof exports === 'object') {
    // CommonJS
    module.exports = factory();
  } else {
    // Browser globals
    root.loki = factory();
  }
}(this, function () {

  return (function () {
    'use strict';

    var hasOwnProperty = Object.prototype.hasOwnProperty;

    function deepFreeze(obj) {
      var prop, i;
      if (Array.isArray(obj)) {
        for (i = 0; i < obj.length; i++) {
          deepFreeze(obj[i]);
        }
        freeze(obj);
      } else if (obj !== null && (typeof obj === 'object')) {
        for (prop in obj) {
          if (obj.hasOwnProperty(prop)) {
            deepFreeze(obj[prop]);
          }
        }
        freeze(obj);
      }
    }

    function freeze(obj) {
      if (!Object.isFrozen(obj)) {
        Object.freeze(obj);
      }
    }

    function unFreeze(obj) {
      if (!Object.isFrozen(obj)) {
        return obj;
      }
      return clone(obj, 'shallow');
    }

    var Utils = {
      copyProperties: function (src, dest) {
        var prop;
        for (prop in src) {
          dest[prop] = src[prop];
        }
      },
      
// (Code skipped for WatermelonDB build)


      // By default (if usingDotNotation is false), looks up path in
      // object via `object[path]`
      //
      // If `usingDotNotation` is true, then the path is assumed to
      // represent a nested path. It can be in the form of an array of
      // field names, or a period delimited string. The function will
      // look up the value of object[path[0]], and then call
      // result[path[1]] on the result, etc etc.
      //
      // If `usingDotNotation` is true, this function still supports
      // non nested fields.
      //
      // `usingDotNotation` is a performance optimization. The caller
      // may know that a path is *not* nested. In which case, this
      // function avoids a costly string.split('.')
      //
      // examples:
      // getIn({a: 1}, "a") => 1
      // getIn({a: 1}, "a", true) => 1
      // getIn({a: {b: 1}}, ["a", "b"], true) => 1
      // getIn({a: {b: 1}}, "a.b", true) => 1
      getIn: function (object, path, usingDotNotation) {
        if (object == null) {
          return undefined;
        }
        if (!usingDotNotation) {
          return object[path];
        }

        if (typeof (path) === "string") {
          path = path.split(".");
        }

        if (!Array.isArray(path)) {
          throw new Error("path must be a string or array. Found " + typeof (path));
        }

        var index = 0,
          length = path.length;

        while (object != null && index < length) {
          object = object[path[index++]];
        }
        return (index && index == length) ? object : undefined;
      }
    };

    // wrapping in object to expose to default export for potential user override.
    // warning: overriding these methods will override behavior for all loki db instances in memory.
    // warning: if you use binary indices these comparators should be the same for all inserts/updates/removes.
    var Comparators = {
      aeq: aeqHelper,
      lt: ltHelper,
      gt: gtHelper
    };

    /** Helper function for determining 'loki' abstract equality which is a little more abstract than ==
     *     aeqHelper(5, '5') === true
     *     aeqHelper(5.0, '5') === true
     *     aeqHelper(new Date("1/1/2011"), new Date("1/1/2011")) === true
     *     aeqHelper({a:1}, {z:4}) === true (all objects sorted equally)
     *     aeqHelper([1, 2, 3], [1, 3]) === false
     *     aeqHelper([1, 2, 3], [1, 2, 3]) === true
     *     aeqHelper(undefined, null) === true
     */
    function aeqHelper(prop1, prop2) {
      var cv1, cv2, t1, t2;

      if (prop1 === prop2) return true;

      // 'falsy' and Boolean handling
      if (!prop1 || !prop2 || prop1 === true || prop2 === true || prop1 !== prop1 || prop2 !== prop2) {
        // dates and NaN conditions (typed dates before serialization)
        switch (prop1) {
          case undefined: t1 = 1; break;
          case null: t1 = 1; break;
          case false: t1 = 3; break;
          case true: t1 = 4; break;
          case "": t1 = 5; break;
          default: t1 = (prop1 === prop1) ? 9 : 0; break;
        }

        switch (prop2) {
          case undefined: t2 = 1; break;
          case null: t2 = 1; break;
          case false: t2 = 3; break;
          case true: t2 = 4; break;
          case "": t2 = 5; break;
          default: t2 = (prop2 === prop2) ? 9 : 0; break;
        }

        // one or both is edge case
        if (t1 !== 9 || t2 !== 9) {
          return (t1 === t2);
        }
      }

      // Handle 'Number-like' comparisons
      cv1 = Number(prop1);
      cv2 = Number(prop2);

      // if one or both are 'number-like'...
      if (cv1 === cv1 || cv2 === cv2) {
        return (cv1 === cv2);
      }

      // not strict equal nor less than nor gt so must be mixed types, convert to string and use that to compare
      cv1 = prop1.toString();
      cv2 = prop2.toString();

      return (cv1 == cv2);
    }

    /** Helper function for determining 'less-than' conditions for ops, sorting, and binary indices.
     *     In the future we might want $lt and $gt ops to use their own functionality/helper.
     *     Since binary indices on a property might need to index [12, NaN, new Date(), Infinity], we
     *     need this function (as well as gtHelper) to always ensure one value is LT, GT, or EQ to another.
     */
    function ltHelper(prop1, prop2, equal) {
      var cv1, cv2, t1, t2;

      // if one of the params is falsy or strictly true or not equal to itself
      // 0, 0.0, "", NaN, null, undefined, not defined, false, true
      if (!prop1 || !prop2 || prop1 === true || prop2 === true || prop1 !== prop1 || prop2 !== prop2) {
        switch (prop1) {
          case undefined: t1 = 1; break;
          case null: t1 = 1; break;
          case false: t1 = 3; break;
          case true: t1 = 4; break;
          case "": t1 = 5; break;
          // if strict equal probably 0 so sort higher, otherwise probably NaN so sort lower than even null
          default: t1 = (prop1 === prop1) ? 9 : 0; break;
        }

        switch (prop2) {
          case undefined: t2 = 1; break;
          case null: t2 = 1; break;
          case false: t2 = 3; break;
          case true: t2 = 4; break;
          case "": t2 = 5; break;
          default: t2 = (prop2 === prop2) ? 9 : 0; break;
        }

        // one or both is edge case
        if (t1 !== 9 || t2 !== 9) {
          return (t1 === t2) ? equal : (t1 < t2);
        }
      }

      // if both are numbers (string encoded or not), compare as numbers
      cv1 = Number(prop1);
      cv2 = Number(prop2);

      if (cv1 === cv1 && cv2 === cv2) {
        if (cv1 < cv2) return true;
        if (cv1 > cv2) return false;
        return equal;
      }

      if (cv1 === cv1 && cv2 !== cv2) {
        return true;
      }

      if (cv2 === cv2 && cv1 !== cv1) {
        return false;
      }

      if (prop1 < prop2) return true;
      if (prop1 > prop2) return false;
      if (prop1 == prop2) return equal;

      // not strict equal nor less than nor gt so must be mixed types, convert to string and use that to compare
      cv1 = prop1.toString();
      cv2 = prop2.toString();

      if (cv1 < cv2) {
        return true;
      }

      if (cv1 == cv2) {
        return equal;
      }

      return false;
    }

    function gtHelper(prop1, prop2, equal) {
      var cv1, cv2, t1, t2;

      // 'falsy' and Boolean handling
      if (!prop1 || !prop2 || prop1 === true || prop2 === true || prop1 !== prop1 || prop2 !== prop2) {
        switch (prop1) {
          case undefined: t1 = 1; break;
          case null: t1 = 1; break;
          case false: t1 = 3; break;
          case true: t1 = 4; break;
          case "": t1 = 5; break;
          // NaN 0
          default: t1 = (prop1 === prop1) ? 9 : 0; break;
        }

        switch (prop2) {
          case undefined: t2 = 1; break;
          case null: t2 = 1; break;
          case false: t2 = 3; break;
          case true: t2 = 4; break;
          case "": t2 = 5; break;
          default: t2 = (prop2 === prop2) ? 9 : 0; break;
        }

        // one or both is edge case
        if (t1 !== 9 || t2 !== 9) {
          return (t1 === t2) ? equal : (t1 > t2);
        }
      }

      // if both are numbers (string encoded or not), compare as numbers
      cv1 = Number(prop1);
      cv2 = Number(prop2);
      if (cv1 === cv1 && cv2 === cv2) {
        if (cv1 > cv2) return true;
        if (cv1 < cv2) return false;
        return equal;
      }

      if (cv1 === cv1 && cv2 !== cv2) {
        return false;
      }

      if (cv2 === cv2 && cv1 !== cv1) {
        return true;
      }

      if (prop1 > prop2) return true;
      if (prop1 < prop2) return false;
      if (prop1 == prop2) return equal;

      // not strict equal nor less than nor gt so must be dates or mixed types
      // convert to string and use that to compare
      cv1 = prop1.toString();
      cv2 = prop2.toString();

      if (cv1 > cv2) {
        return true;
      }

      if (cv1 == cv2) {
        return equal;
      }

      return false;
    }

    function sortHelper(prop1, prop2, desc) {
      if (Comparators.aeq(prop1, prop2)) return 0;

      if (Comparators.lt(prop1, prop2, false)) {
        return (desc) ? (1) : (-1);
      }

      if (Comparators.gt(prop1, prop2, false)) {
        return (desc) ? (-1) : (1);
      }

      // not lt, not gt so implied equality-- date compatible
      return 0;
    }

    /**
     * compoundeval() - helper function for compoundsort(), performing individual object comparisons
     *
     * @param {array} properties - array of property names, in order, by which to evaluate sort order
     * @param {object} obj1 - first object to compare
     * @param {object} obj2 - second object to compare
     * @returns {integer} 0, -1, or 1 to designate if identical (sortwise) or which should be first
     */
    function compoundeval(properties, obj1, obj2) {
      var res = 0;
      var prop, field, val1, val2, arr, path;
      for (var i = 0, len = properties.length; i < len; i++) {
        prop = properties[i];
        field = prop[0];
        if (~field.indexOf('.')) {
          arr = field.split('.');
          val1 = Utils.getIn(obj1, arr, true);
          val2 = Utils.getIn(obj2, arr, true);
        } else {
          val1 = obj1[field];
          val2 = obj2[field];
        }
        res = sortHelper(val1, val2, prop[1]);
        if (res !== 0) {
          return res;
        }
      }
      return 0;
    }

    /**
     * dotSubScan - helper function used for dot notation queries.
     *
     * @param {object} root - object to traverse
     * @param {array} paths - array of properties to drill into
     * @param {function} fun - evaluation function to test with
     * @param {any} value - comparative value to also pass to (compare) fun
     * @param {any} extra - extra arg to also pass to compare fun
     * @param {number} poffset - index of the item in 'paths' to start the sub-scan from
     */
    function dotSubScan(root, paths, fun, value, extra, poffset) {
      var pathOffset = poffset || 0;
      var path = paths[pathOffset];

      var valueFound = false;
      var element;
      if (typeof root === 'object' && path in root) {
        element = root[path];
      }
      if (pathOffset + 1 >= paths.length) {
        // if we have already expanded out the dot notation,
        // then just evaluate the test function and value on the element
        valueFound = fun(element, value, extra);
      } else if (Array.isArray(element)) {
        for (var index = 0, len = element.length; index < len; index += 1) {
          valueFound = dotSubScan(element[index], paths, fun, value, extra, pathOffset + 1);
          if (valueFound === true) {
            break;
          }
        }
      } else {
        valueFound = dotSubScan(element, paths, fun, value, extra, pathOffset + 1);
      }

      return valueFound;
    }

    function containsCheckFn(a) {
      if (typeof a === 'string' || Array.isArray(a)) {
        return function (b) {
          return a.indexOf(b) !== -1;
        };
      } else if (typeof a === 'object' && a !== null) {
        return function (b) {
          return hasOwnProperty.call(a, b);
        };
      }
      return null;
    }

    function doQueryOp(val, op, record) {
      for (var p in op) {
        if (hasOwnProperty.call(op, p)) {
          return LokiOps[p](val, op[p], record);
        }
      }
      return false;
    }

    var LokiOps = {
      // comparison operators
      // a is the value in the collection
      // b is the query value
      $eq: function (a, b) {
        return a === b;
      },

      // abstract/loose equality
      $aeq: function (a, b) {
        return a == b;
      },

      $ne: function (a, b) {
        // ecma 5 safe test for NaN
        if (b !== b) {
          // ecma 5 test value is not NaN
          return (a === a);
        }

        return a !== b;
      },
      // date equality / loki abstract equality test
      $dteq: function (a, b) {
        return Comparators.aeq(a, b);
      },

      // loki comparisons: return identical unindexed results as indexed comparisons
      $gt: function (a, b) {
        return Comparators.gt(a, b, false);
      },

      $gte: function (a, b) {
        return Comparators.gt(a, b, true);
      },

      $lt: function (a, b) {
        return Comparators.lt(a, b, false);
      },

      $lte: function (a, b) {
        return Comparators.lt(a, b, true);
      },

      // lightweight javascript comparisons
      $jgt: function (a, b) {
        return a > b;
      },

      $jgte: function (a, b) {
        return a >= b;
      },

      $jlt: function (a, b) {
        return a < b;
      },

      $jlte: function (a, b) {
        return a <= b;
      },

      // ex : coll.find({'orderCount': {$between: [10, 50]}});
      $between: function (a, vals) {
        if (a === undefined || a === null) return false;
        return (Comparators.gt(a, vals[0], true) && Comparators.lt(a, vals[1], true));
      },

      $jbetween: function (a, vals) {
        if (a === undefined || a === null) return false;
        return (a >= vals[0] && a <= vals[1]);
      },

      $in: function (a, b) {
        return b.indexOf(a) !== -1;
      },

      $inSet: function(a, b) {
        return b.has(a);
      },

      $nin: function (a, b) {
        return b.indexOf(a) === -1;
      },

      $keyin: function (a, b) {
        return a in b;
      },

      $nkeyin: function (a, b) {
        return !(a in b);
      },

      $definedin: function (a, b) {
        return b[a] !== undefined;
      },

      $undefinedin: function (a, b) {
        return b[a] === undefined;
      },

      $regex: function (a, b) {
        return b.test(a);
      },

      $containsString: function (a, b) {
        return (typeof a === 'string') && (a.indexOf(b) !== -1);
      },

      $containsNone: function (a, b) {
        return !LokiOps.$containsAny(a, b);
      },

      $containsAny: function (a, b) {
        var checkFn = containsCheckFn(a);
        if (checkFn !== null) {
          return (Array.isArray(b)) ? (b.some(checkFn)) : (checkFn(b));
        }
        return false;
      },

      $contains: function (a, b) {
        var checkFn = containsCheckFn(a);
        if (checkFn !== null) {
          return (Array.isArray(b)) ? (b.every(checkFn)) : (checkFn(b));
        }
        return false;
      },

      $elemMatch: function (a, b) {
        if (Array.isArray(a)) {
          return a.some(function (item) {
            return Object.keys(b).every(function (property) {
              var filter = b[property];
              if (!(typeof filter === 'object' && filter)) {
                filter = { $eq: filter };
              }

              if (property.indexOf('.') !== -1) {
                return dotSubScan(item, property.split('.'), doQueryOp, b[property], item);
              }
              return doQueryOp(item[property], filter, item);
            });
          });
        }
        return false;
      },

      $type: function (a, b, record) {
        var type = typeof a;
        if (type === 'object') {
          if (Array.isArray(a)) {
            type = 'array';
          } else if (a instanceof Date) {
            type = 'date';
          }
        }
        return (typeof b !== 'object') ? (type === b) : doQueryOp(type, b, record);
      },

      $finite: function (a, b) {
        return (b === isFinite(a));
      },

      $size: function (a, b, record) {
        if (Array.isArray(a)) {
          return (typeof b !== 'object') ? (a.length === b) : doQueryOp(a.length, b, record);
        }
        return false;
      },

      $len: function (a, b, record) {
        if (typeof a === 'string') {
          return (typeof b !== 'object') ? (a.length === b) : doQueryOp(a.length, b, record);
        }
        return false;
      },

      $where: function (a, b) {
        return b(a) === true;
      },

      // field-level logical operators
      // a is the value in the collection
      // b is the nested query operation (for '$not')
      //   or an array of nested query operations (for '$and' and '$or')
      $not: function (a, b, record) {
        return !doQueryOp(a, b, record);
      },

      $and: function (a, b, record) {
        for (var idx = 0, len = b.length; idx < len; idx += 1) {
          if (!doQueryOp(a, b[idx], record)) {
            return false;
          }
        }
        return true;
      },

      $or: function (a, b, record) {
        for (var idx = 0, len = b.length; idx < len; idx += 1) {
          if (doQueryOp(a, b[idx], record)) {
            return true;
          }
        }
        return false;
      },

      $exists: function (a, b) {
        if (b) {
          return a !== undefined;
        } else {
          return a === undefined;
        }
      }
    };

    // ops that can be used with { $$op: 'column-name' } syntax
    var valueLevelOps = ['$eq', '$aeq', '$ne', '$dteq', '$gt', '$gte', '$lt', '$lte', '$jgt', '$jgte', '$jlt', '$jlte', '$type'];
    valueLevelOps.forEach(function (op) {
      var fun = LokiOps[op];
      LokiOps['$' + op] = function (a, spec, record) {
        if (typeof spec === 'string') {
          return fun(a, record[spec]);
        } else if (typeof spec === 'function') {
          return fun(a, spec(record));
        } else {
          throw new Error('Invalid argument to $$ matcher');
        }
      };
    });

    // if an op is registered in this object, our 'calculateRange' can use it with our binary indices.
    // if the op is registered to a function, we will run that function/op as a 2nd pass filter on results.
    // those 2nd pass filter functions should be similar to LokiOps functions, accepting 2 vals to compare.
    var indexedOps = {
      $eq: LokiOps.$eq,
      $aeq: true,
      $dteq: true,
      $gt: true,
      $gte: true,
      $lt: true,
      $lte: true,
      $in: true,
      $between: true
    };

    function clone(data, method) {
      if (data === null || data === undefined) {
        return null;
      }

      var cloneMethod = method || 'parse-stringify',
        cloned;

      switch (cloneMethod) {
        case "parse-stringify":
          cloned = JSON.parse(JSON.stringify(data));
          break;
        
// (Code skipped for WatermelonDB build)

        default:
          break;
      }

      return cloned;
    }

    function cloneObjectArray(objarray, method) {
      if (method == "parse-stringify") {
        return clone(objarray, method);
      }
      var result = [];
      for (var i = 0, len = objarray.length; i < len; i++) {
        result[i] = clone(objarray[i], method);
      }
      return result;
    }

    
// (Code skipped for WatermelonDB build)


    /**
     * LokiEventEmitter is a minimalist version of EventEmitter. It enables any
     * constructor that inherits EventEmitter to emit events and trigger
     * listeners that have been added to the event through the on(event, callback) method
     *
     * @constructor LokiEventEmitter
     */
    function LokiEventEmitter() { }

    /**
     * @prop {hashmap} events - a hashmap, with each property being an array of callbacks
     * @memberof LokiEventEmitter
     */
    LokiEventEmitter.prototype.events = {};

    /**
     * @prop {boolean} asyncListeners - boolean determines whether or not the callbacks associated with each event
     * should happen in an async fashion or not
     * Default is false, which means events are synchronous
     * @memberof LokiEventEmitter
     */
    LokiEventEmitter.prototype.asyncListeners = false;

    /**
     * on(eventName, listener) - adds a listener to the queue of callbacks associated to an event
     * @param {string|string[]} eventName - the name(s) of the event(s) to listen to
     * @param {function} listener - callback function of listener to attach
     * @returns {int} the index of the callback in the array of listeners for a particular event
     * @memberof LokiEventEmitter
     */
    LokiEventEmitter.prototype.on = function (eventName, listener) {
      var event;
      var self = this;

      if (Array.isArray(eventName)) {
        eventName.forEach(function (currentEventName) {
          self.on(currentEventName, listener);
        });
        return listener;
      }

      event = this.events[eventName];
      if (!event) {
        event = this.events[eventName] = [];
      }
      event.push(listener);
      return listener;
    };

    /**
     * emit(eventName, data) - emits a particular event
     * with the option of passing optional parameters which are going to be processed by the callback
     * provided signatures match (i.e. if passing emit(event, arg0, arg1) the listener should take two parameters)
     * @param {string} eventName - the name of the event
     * @param {object=} data - optional object passed with the event
     * @memberof LokiEventEmitter
     */
    LokiEventEmitter.prototype.emit = function (eventName) {
      var self = this;
      var selfArgs;
      if (eventName && this.events[eventName]) {
        if (this.events[eventName].length) {
          selfArgs = Array.prototype.slice.call(arguments, 1);
          this.events[eventName].forEach(function (listener) {
            if (self.asyncListeners) {
              setTimeout(function () {
                listener.apply(self, selfArgs);
              }, 1);
            } else {
              listener.apply(self, selfArgs);
            }
          });
        }
      } else {
        throw new Error('No event ' + eventName + ' defined');
      }
    };

    /**
     * Alias of LokiEventEmitter.prototype.on
     * addListener(eventName, listener) - adds a listener to the queue of callbacks associated to an event
     * @param {string|string[]} eventName - the name(s) of the event(s) to listen to
     * @param {function} listener - callback function of listener to attach
     * @returns {int} the index of the callback in the array of listeners for a particular event
     * @memberof LokiEventEmitter
     */
    LokiEventEmitter.prototype.addListener = LokiEventEmitter.prototype.on;

    /**
     * removeListener() - removes the listener at position 'index' from the event 'eventName'
     * @param {string|string[]} eventName - the name(s) of the event(s) which the listener is attached to
     * @param {function} listener - the listener callback function to remove from emitter
     * @memberof LokiEventEmitter
     */
    LokiEventEmitter.prototype.removeListener = function (eventName, listener) {
      var self = this;

      if (Array.isArray(eventName)) {
        eventName.forEach(function (currentEventName) {
          self.removeListener(currentEventName, listener);
        });

        return;
      }

      if (this.events[eventName]) {
        var listeners = this.events[eventName];
        listeners.splice(listeners.indexOf(listener), 1);
      }
    };

    /**
     * Loki: The main database class
     * @constructor Loki
     * @implements LokiEventEmitter
     * @param {string} filename - name of the file to be saved to
     * @param {object=} options - (Optional) config options object
     * @param {string} options.env - override environment detection as 'NODEJS', 'BROWSER', 'CORDOVA'
     * @param {boolean} [options.verbose=false] - enable console output
     * @param {boolean} [options.autosave=false] - enables autosave
     * @param {int} [options.autosaveInterval=5000] - time interval (in milliseconds) between saves (if dirty)
     * @param {boolean} [options.autoload=false] - enables autoload on loki instantiation
     * @param {function} options.autoloadCallback - user callback called after database load
     * @param {adapter} options.adapter - an instance of a loki persistence adapter
     * @param {string} [options.serializationMethod='normal'] - ['normal', 'pretty', 'destructured']
     * @param {string} options.destructureDelimiter - string delimiter used for destructured serialization
     * @param {boolean} [options.throttledSaves=true] - debounces multiple calls to to saveDatabase reducing number of disk I/O operations
                                                and guaranteeing proper serialization of the calls.
     */
    function Loki(filename, options) {
      this.filename = filename || 'loki.db';
      this.collections = [];

      // persist version of code which created the database to the database.
      // could use for upgrade scenarios
      this.databaseVersion = 1.5;
      this.engineVersion = 1.5;

      // autosave support (disabled by default)
      // pass autosave: true, autosaveInterval: 6000 in options to set 6 second autosave
      this.autosave = false;
      this.autosaveInterval = 5000;
      this.autosaveHandle = null;
      this.throttledSaves = true;

      this.options = {};

      // currently keeping persistenceMethod and persistenceAdapter as loki level properties that
      // will not or cannot be deserialized.  You are required to configure persistence every time
      // you instantiate a loki object (or use default environment detection) in order to load the database anyways.

      // persistenceMethod could be 'fs', 'localStorage', or 'adapter'
      // this is optional option param, otherwise environment detection will be used
      // if user passes their own adapter we will force this method to 'adapter' later, so no need to pass method option.
      this.persistenceMethod = null;

      // retain reference to optional (non-serializable) persistenceAdapter 'instance'
      this.persistenceAdapter = null;

      // flags used to throttle saves
      this.throttledSavePending = false;
      this.throttledCallbacks = [];

      // enable console output if verbose flag is set (disabled by default)
      this.verbose = options && options.hasOwnProperty('verbose') ? options.verbose : false;

      this.events = {
        'init': [],
        'loaded': [],
        'flushChanges': [],
        'close': [],
        'changes': [],
        'warning': []
      };

      
// (Code skipped for WatermelonDB build)


      this.configureOptions(options, true);

      
// (Code skipped for WatermelonDB build)

    }

    // db class is an EventEmitter
    Loki.prototype = new LokiEventEmitter();
    Loki.prototype.constructor = Loki;

    // experimental support for browserify's abstract syntax scan to pick up dependency of indexed adapter.
    // Hopefully, once this hits npm a browserify require of lokijs should scan the main file and detect this indexed adapter reference.
    
// (Code skipped for WatermelonDB build)


    /**
     * Allows reconfiguring database options
     *
     * @param {object} options - configuration options to apply to loki db object
     * @param {string} options.env - override environment detection as 'NODEJS', 'BROWSER', 'CORDOVA'
     * @param {boolean} options.verbose - enable console output (default is 'false')
     * @param {boolean} options.autosave - enables autosave
     * @param {int} options.autosaveInterval - time interval (in milliseconds) between saves (if dirty)
     * @param {boolean} options.autoload - enables autoload on loki instantiation
     * @param {function} options.autoloadCallback - user callback called after database load
     * @param {adapter} options.adapter - an instance of a loki persistence adapter
     * @param {string} options.serializationMethod - ['normal', 'pretty', 'destructured']
     * @param {string} options.destructureDelimiter - string delimiter used for destructured serialization
     * @param {boolean} initialConfig - (internal) true is passed when loki ctor is invoking
     * @memberof Loki
     */
    Loki.prototype.configureOptions = function (options, initialConfig) {
      var defaultPersistence = {
        'NODEJS': 'fs',
        'BROWSER': 'localStorage',
        'CORDOVA': 'localStorage',
        'MEMORY': 'memory'
      },
        persistenceMethods = {
          
// (Code skipped for WatermelonDB build)

          'memory': LokiMemoryAdapter
        };

      this.options = {};

      this.persistenceMethod = null;
      // retain reference to optional persistence adapter 'instance'
      // currently keeping outside options because it can't be serialized
      this.persistenceAdapter = null;

      // process the options
      if (typeof (options) !== 'undefined') {
        this.options = options;

        if (this.options.hasOwnProperty('persistenceMethod')) {
          // check if the specified persistence method is known
          if (typeof (persistenceMethods[options.persistenceMethod]) == 'function') {
            this.persistenceMethod = options.persistenceMethod;
            this.persistenceAdapter = new persistenceMethods[options.persistenceMethod]();
          }
          // should be throw an error here, or just fall back to defaults ??
        }

        // if user passes adapter, set persistence mode to adapter and retain persistence adapter instance
        if (this.options.hasOwnProperty('adapter')) {
          this.persistenceMethod = 'adapter';
          this.persistenceAdapter = options.adapter;
          this.options.adapter = null;

          // if true, will keep track of dirty ids
          this.isIncremental = this.persistenceAdapter.mode === 'incremental';
        }


        // if they want to load database on loki instantiation, now is a good time to load... after adapter set and before possible autosave initiation
        if (options.autoload && initialConfig) {
          // for autoload, let the constructor complete before firing callback
          var self = this;
          setTimeout(function () {
            self.loadDatabase(options, options.autoloadCallback);
          }, 1);
        }

        if (this.options.hasOwnProperty('autosaveInterval')) {
          this.autosaveDisable();
          this.autosaveInterval = parseInt(this.options.autosaveInterval, 10);
        }

        if (this.options.hasOwnProperty('autosave') && this.options.autosave) {
          this.autosaveDisable();
          this.autosave = true;

          if (this.options.hasOwnProperty('autosaveCallback')) {
            this.autosaveEnable(options, options.autosaveCallback);
          } else {
            this.autosaveEnable();
          }
        }

        if (this.options.hasOwnProperty('throttledSaves')) {
          this.throttledSaves = this.options.throttledSaves;
        }
      } // end of options processing

      // ensure defaults exists for options which were not set
      if (!this.options.hasOwnProperty('serializationMethod')) {
        this.options.serializationMethod = 'normal';
      }

      // ensure passed or default option exists
      if (!this.options.hasOwnProperty('destructureDelimiter')) {
        this.options.destructureDelimiter = '$<\n';
      }

      // if by now there is no adapter specified by user nor derived from persistenceMethod: use sensible defaults
      if (this.persistenceAdapter === null) {
        this.persistenceMethod = defaultPersistence[this.ENV];
        if (this.persistenceMethod) {
          this.persistenceAdapter = new persistenceMethods[this.persistenceMethod]();
        }
      }

    };

    /**
     * Copies 'this' database into a new Loki instance. Object references are shared to make lightweight.
     *
     * @param {object} options - apply or override collection level settings
     * @param {bool} options.removeNonSerializable - nulls properties not safe for serialization.
     * @memberof Loki
     */
    Loki.prototype.copy = function (options) {
      // in case running in an environment without accurate environment detection, pass 'NA'
      var databaseCopy = new Loki(this.filename, { env: "NA" });
      var clen, idx;

      options = options || {};

      // currently inverting and letting loadJSONObject do most of the work
      databaseCopy.loadJSONObject(this, { retainDirtyFlags: true });

      // since our JSON serializeReplacer is not invoked for reference database adapters, this will let us mimic
      if (options.hasOwnProperty("removeNonSerializable") && options.removeNonSerializable === true) {
        databaseCopy.autosaveHandle = null;
        databaseCopy.persistenceAdapter = null;

        clen = databaseCopy.collections.length;
        for (idx = 0; idx < clen; idx++) {
          databaseCopy.collections[idx].constraints = null;
          databaseCopy.collections[idx].ttl = null;
        }
      }

      return databaseCopy;
    };

    /**
     * Adds a collection to the database.
     * @param {string} name - name of collection to add
     * @param {object=} options - (optional) options to configure collection with.
     * @param {array=} [options.unique=[]] - array of property names to define unique constraints for
     * @param {array=} [options.exact=[]] - array of property names to define exact constraints for
     * @param {array=} [options.indices=[]] - array property names to define binary indexes for
     * @param {boolean} [options.asyncListeners=false] - whether listeners are called asynchronously
     * @param {boolean} [options.disableMeta=false] - set to true to disable meta property on documents
     * @param {boolean} [options.disableChangesApi=true] - set to false to enable Changes Api
     * @param {boolean} [options.disableDeltaChangesApi=true] - set to false to enable Delta Changes API (requires Changes API, forces cloning)
     * @param {boolean} [options.autoupdate=false] - use Object.observe to update objects automatically
     * @param {boolean} [options.clone=false] - specify whether inserts and queries clone to/from user
     * @param {string} [options.cloneMethod='parse-stringify'] - 'parse-stringify', 'jquery-extend-deep', 'shallow, 'shallow-assign'
     * @param {int=} options.ttl - age of document (in ms.) before document is considered aged/stale.
     * @param {int=} options.ttlInterval - time interval for clearing out 'aged' documents; not set by default.
     * @returns {Collection} a reference to the collection which was just added
     * @memberof Loki
     */
    Loki.prototype.addCollection = function (name, options) {
      var i,
        len = this.collections.length;

      
// (Code skipped for WatermelonDB build)


      for (i = 0; i < len; i += 1) {
        if (this.collections[i].name === name) {
          return this.collections[i];
        }
      }

      var collection = new Collection(name, options);
      collection.isIncremental = this.isIncremental;
      this.collections.push(collection);

      if (this.verbose)
        collection.lokiConsoleWrapper = console;

      return collection;
    };

    Loki.prototype.loadCollection = function (collection) {
      if (!collection.name) {
        throw new Error('Collection must have a name property to be loaded');
      }
      this.collections.push(collection);
    };

    /**
     * Retrieves reference to a collection by name.
     * @param {string} collectionName - name of collection to look up
     * @returns {Collection} Reference to collection in database by that name, or null if not found
     * @memberof Loki
     */
    Loki.prototype.getCollection = function (collectionName) {
      var i,
        len = this.collections.length;

      for (i = 0; i < len; i += 1) {
        if (this.collections[i].name === collectionName) {
          return this.collections[i];
        }
      }

      // no such collection
      this.emit('warning', 'collection ' + collectionName + ' not found');
      return null;
    };

    /**
     * Renames an existing loki collection
     * @param {string} oldName - name of collection to rename
     * @param {string} newName - new name of collection
     * @returns {Collection} reference to the newly renamed collection
     * @memberof Loki
     */
    Loki.prototype.renameCollection = function (oldName, newName) {
      var c = this.getCollection(oldName);

      if (c) {
        c.name = newName;
      }

      return c;
    };
    
// (Code skipped for WatermelonDB build)

    /**
     * Removes a collection from the database.
     * @param {string} collectionName - name of collection to remove
     * @memberof Loki
     */
    Loki.prototype.removeCollection = function (collectionName) {
      var i,
        len = this.collections.length;

      for (i = 0; i < len; i += 1) {
        if (this.collections[i].name === collectionName) {
          var tmpcol = new Collection(collectionName, {});
          var curcol = this.collections[i];
          for (var prop in curcol) {
            if (curcol.hasOwnProperty(prop) && tmpcol.hasOwnProperty(prop)) {
              curcol[prop] = tmpcol[prop];
            }
          }
          this.collections.splice(i, 1);
          return;
        }
      }
    };

    Loki.prototype.getName = function () {
      return this.name;
    };

    /**
     * serializeReplacer - used to prevent certain properties from being serialized
     *
     */
    Loki.prototype.serializeReplacer = function (key, value) {
      switch (key) {
        case 'autosaveHandle':
        case 'persistenceAdapter':
        case 'constraints':
        case 'ttl':
          return null;
        case 'throttledSavePending':
        case 'throttledCallbacks':
          return undefined;
        case 'lokiConsoleWrapper':
          return null;
        default:
          return value;
      }
    };

    /**
     * Serialize database to a string which can be loaded via {@link Loki#loadJSON}
     *
     * @returns {string} Stringified representation of the loki database.
     * @memberof Loki
     */
    Loki.prototype.serialize = function (options) {
      options = options || {};

      if (!options.hasOwnProperty("serializationMethod")) {
        options.serializationMethod = this.options.serializationMethod;
      }

      switch (options.serializationMethod) {
        case "normal": return JSON.stringify(this, this.serializeReplacer);
        case "pretty": return JSON.stringify(this, this.serializeReplacer, 2);
        case "destructured": return this.serializeDestructured(); // use default options
        default: return JSON.stringify(this, this.serializeReplacer);
      }
    };

    // alias of serialize
    Loki.prototype.toJson = Loki.prototype.serialize;
    
// (Code skipped for WatermelonDB build)

    /**
     * Inflates a loki database from a serialized JSON string
     *
     * @param {string} serializedDb - a serialized loki database string
     * @param {object=} options - apply or override collection level settings
     * @param {bool} options.retainDirtyFlags - whether collection dirty flags will be preserved
     * @memberof Loki
     */
    Loki.prototype.loadJSON = function (serializedDb, options) {
      var dbObject;
      if (serializedDb.length === 0) {
        dbObject = {};
      } else {

        // using option defined in instantiated db not what was in serialized db
        switch (this.options.serializationMethod) {
          case "normal":
          case "pretty": dbObject = JSON.parse(serializedDb); break;
          case "destructured": dbObject = this.deserializeDestructured(serializedDb); break;
          default: dbObject = JSON.parse(serializedDb); break;
        }
      }

      this.loadJSONObject(dbObject, options);
    };

    /**
     * Inflates a loki database from a JS object
     *
     * @param {object} dbObject - a serialized loki database string
     * @param {object=} options - apply or override collection level settings
     * @param {bool} options.retainDirtyFlags - whether collection dirty flags will be preserved
     * @memberof Loki
     */
    Loki.prototype.loadJSONObject = function (dbObject, options) {
      var i = 0,
        len = dbObject.collections ? dbObject.collections.length : 0,
        coll,
        copyColl,
        clen,
        j,
        loader,
        collObj;

      this.name = dbObject.name;

      // restore save throttled boolean only if not defined in options
      if (dbObject.hasOwnProperty('throttledSaves') && options && !options.hasOwnProperty('throttledSaves')) {
        this.throttledSaves = dbObject.throttledSaves;
      }

      this.collections = [];

      function makeLoader(coll) {
        var collOptions = options[coll.name];
        var inflater;

        if (collOptions.proto) {
          inflater = collOptions.inflate || Utils.copyProperties;

          return function (data) {
            var collObj = new (collOptions.proto)();
            inflater(data, collObj);
            return collObj;
          };
        }

        return collOptions.inflate;
      }

      for (i; i < len; i += 1) {
        coll = dbObject.collections[i];

        copyColl = this.addCollection(coll.name, {
          disableChangesApi: coll.disableChangesApi,
          disableDeltaChangesApi: coll.disableDeltaChangesApi,
          disableMeta: coll.disableMeta,
          disableFreeze: coll.hasOwnProperty('disableFreeze') ? coll.disableFreeze : true
        });

        copyColl.adaptiveBinaryIndices = coll.hasOwnProperty('adaptiveBinaryIndices') ? (coll.adaptiveBinaryIndices === true) : false;
        copyColl.transactional = coll.transactional;
        copyColl.asyncListeners = coll.asyncListeners;
        copyColl.cloneObjects = coll.cloneObjects;
        copyColl.cloneMethod = coll.cloneMethod || "parse-stringify";
        copyColl.autoupdate = coll.autoupdate;
        copyColl.changes = coll.changes;
        copyColl.dirtyIds = coll.dirtyIds || [];

        if (options && options.retainDirtyFlags === true) {
          copyColl.dirty = coll.dirty;
        }
        else {
          copyColl.dirty = false;
        }

        if (coll.getData) {
          if ((options && options.hasOwnProperty(coll.name)) || !copyColl.disableFreeze || copyColl.autoupdate) {
            throw new Error("this collection cannot be loaded lazily: " + coll.name);
          }
          copyColl.getData = coll.getData;
          Object.defineProperty(copyColl, 'data', {
            /* jshint loopfunc:true */
            get: function() {
              var data = this.getData();
              this.getData = null;
              Object.defineProperty(this, 'data', { value: data });
              return data;
            }
            /* jshint loopfunc:false */
          });
        } else {
          // load each element individually
          clen = coll.data.length;
          j = 0;
          if (options && options.hasOwnProperty(coll.name)) {
            loader = makeLoader(coll);

            for (j; j < clen; j++) {
              collObj = loader(coll.data[j]);
              copyColl.data[j] = collObj;
              copyColl.addAutoUpdateObserver(collObj);
              if (!copyColl.disableFreeze) {
                deepFreeze(copyColl.data[j]);
              }
            }
          } else {
            for (j; j < clen; j++) {
              copyColl.data[j] = coll.data[j];
              copyColl.addAutoUpdateObserver(copyColl.data[j]);
              if (!copyColl.disableFreeze) {
                deepFreeze(copyColl.data[j]);
              }
            }
          }
        }

        copyColl.maxId = (typeof coll.maxId === 'undefined') ? 0 : coll.maxId;
        if (typeof (coll.binaryIndices) !== 'undefined') {
          copyColl.binaryIndices = coll.binaryIndices;
        }
        if (typeof coll.transforms !== 'undefined') {
          copyColl.transforms = coll.transforms;
        }

        // regenerate unique indexes
        copyColl.uniqueNames = [];
        if (coll.hasOwnProperty("uniqueNames")) {
          copyColl.uniqueNames = coll.uniqueNames;
        }

        
// (Code skipped for WatermelonDB build)


        // Upgrade Logic for binary index refactoring at version 1.5
        if (dbObject.databaseVersion < 1.5) {
          // rebuild all indices
          copyColl.ensureAllIndexes(true);
          copyColl.dirty = true;
        }
      }
    };

    /**
     * Emits the close event. In autosave scenarios, if the database is dirty, this will save and disable timer.
     * Does not actually destroy the db.
     *
     * @param {function=} callback - (Optional) if supplied will be registered with close event before emitting.
     * @memberof Loki
     */
    Loki.prototype.close = function (callback) {
      // for autosave scenarios, we will let close perform final save (if dirty)
      // For web use, you might call from window.onbeforeunload to shutdown database, saving pending changes
      if (this.autosave) {
        this.autosaveDisable();
        if (this.autosaveDirty()) {
          this.saveDatabase(callback);
          callback = undefined;
        }
      }

      if (callback) {
        this.on('close', callback);
      }
      this.emit('close');
    };

    
// (Code skipped for WatermelonDB build)

    /*------------------+
    | PERSISTENCE       |
    -------------------*/

    /** there are two build in persistence adapters for internal use
     * fs             for use in Nodejs type environments
     * localStorage   for use in browser environment
     * defined as helper classes here so its easy and clean to use
     */

    /**
     * In in-memory persistence adapter for an in-memory database.
     * This simple 'key/value' adapter is intended for unit testing and diagnostics.
     *
     * @param {object=} options - memory adapter options
     * @param {boolean} [options.asyncResponses=false] - whether callbacks are invoked asynchronously
     * @param {int} [options.asyncTimeout=50] - timeout in ms to queue callbacks
     * @constructor LokiMemoryAdapter
     */
    function LokiMemoryAdapter(options) {
      this.hashStore = {};
      this.options = options || {};

      if (!this.options.hasOwnProperty('asyncResponses')) {
        this.options.asyncResponses = false;
      }

      if (!this.options.hasOwnProperty('asyncTimeout')) {
        this.options.asyncTimeout = 50; // 50 ms default
      }
    }

    /**
     * Loads a serialized database from its in-memory store.
     * (Loki persistence adapter interface function)
     *
     * @param {string} dbname - name of the database (filename/keyname)
     * @param {function} callback - adapter callback to return load result to caller
     * @memberof LokiMemoryAdapter
     */
    LokiMemoryAdapter.prototype.loadDatabase = function (dbname, callback) {
      var self = this;

      if (this.options.asyncResponses) {
        setTimeout(function () {
          if (self.hashStore.hasOwnProperty(dbname)) {
            callback(self.hashStore[dbname].value);
          }
          else {
            // database doesn't exist, return falsy
            callback(null);
          }
        }, this.options.asyncTimeout);
      }
      else {
        if (this.hashStore.hasOwnProperty(dbname)) {
          // database doesn't exist, return falsy
          callback(this.hashStore[dbname].value);
        }
        else {
          callback(null);
        }
      }
    };

    /**
     * Saves a serialized database to its in-memory store.
     * (Loki persistence adapter interface function)
     *
     * @param {string} dbname - name of the database (filename/keyname)
     * @param {function} callback - adapter callback to return load result to caller
     * @memberof LokiMemoryAdapter
     */
    LokiMemoryAdapter.prototype.saveDatabase = function (dbname, dbstring, callback) {
      var self = this;
      var saveCount;

      if (this.options.asyncResponses) {
        setTimeout(function () {
          saveCount = (self.hashStore.hasOwnProperty(dbname) ? self.hashStore[dbname].savecount : 0);

          self.hashStore[dbname] = {
            savecount: saveCount + 1,
            lastsave: new Date(),
            value: dbstring
          };

          callback();
        }, this.options.asyncTimeout);
      }
      else {
        saveCount = (this.hashStore.hasOwnProperty(dbname) ? this.hashStore[dbname].savecount : 0);

        this.hashStore[dbname] = {
          savecount: saveCount + 1,
          lastsave: new Date(),
          value: dbstring
        };

        callback();
      }
    };

    /**
     * Deletes a database from its in-memory store.
     *
     * @param {string} dbname - name of the database (filename/keyname)
     * @param {function} callback - function to call when done
     * @memberof LokiMemoryAdapter
     */
    LokiMemoryAdapter.prototype.deleteDatabase = function (dbname, callback) {
      if (this.hashStore.hasOwnProperty(dbname)) {
        delete this.hashStore[dbname];
      }

      if (typeof callback === "function") {
        callback();
      }
    };
    
// (Code skipped for WatermelonDB build)

    /**
     * Wait for throttledSaves to complete and invoke your callback when drained or duration is met.
     *
     * @param {function} callback - callback to fire when save queue is drained, it is passed a sucess parameter value
     * @param {object=} options - configuration options
     * @param {boolean} options.recursiveWait - (default: true) if after queue is drained, another save was kicked off, wait for it
     * @param {bool} options.recursiveWaitLimit - (default: false) limit our recursive waiting to a duration
     * @param {int} options.recursiveWaitLimitDelay - (default: 2000) cutoff in ms to stop recursively re-draining
     * @memberof Loki
     */
    Loki.prototype.throttledSaveDrain = function (callback, options) {
      var self = this;
      var now = (new Date()).getTime();

      if (!this.throttledSaves) {
        callback(true);
      }

      options = options || {};
      if (!options.hasOwnProperty('recursiveWait')) {
        options.recursiveWait = true;
      }
      if (!options.hasOwnProperty('recursiveWaitLimit')) {
        options.recursiveWaitLimit = false;
      }
      if (!options.hasOwnProperty('recursiveWaitLimitDuration')) {
        options.recursiveWaitLimitDuration = 2000;
      }
      if (!options.hasOwnProperty('started')) {
        options.started = (new Date()).getTime();
      }

      // if save is pending
      if (this.throttledSaves && this.throttledSavePending) {
        // if we want to wait until we are in a state where there are no pending saves at all
        if (options.recursiveWait) {
          // queue the following meta callback for when it completes
          this.throttledCallbacks.push(function () {
            // if there is now another save pending...
            if (self.throttledSavePending) {
              // if we wish to wait only so long and we have exceeded limit of our waiting, callback with false success value
              if (options.recursiveWaitLimit && (now - options.started > options.recursiveWaitLimitDuration)) {
                callback(false);
                return;
              }
              // it must be ok to wait on next queue drain
              self.throttledSaveDrain(callback, options);
              return;
            }
            // no pending saves so callback with true success
            else {
              callback(true);
              return;
            }
          });
        }
        // just notify when current queue is depleted
        else {
          this.throttledCallbacks.push(callback);
          return;
        }
      }
      // no save pending, just callback
      else {
        callback(true);
      }
    };

    /**
     * Internal load logic, decoupled from throttling/contention logic
     *
     * @param {object} options - not currently used (remove or allow overrides?)
     * @param {function=} callback - (Optional) user supplied async callback / error handler
     */
    Loki.prototype.loadDatabaseInternal = function (options, callback) {
      var cFun = callback || function (err, data) {
        if (err) {
          throw err;
        }
      },
        self = this;

      // the persistenceAdapter should be present if all is ok, but check to be sure.
      if (this.persistenceAdapter !== null) {

        this.persistenceAdapter.loadDatabase(this.filename, function loadDatabaseCallback(dbString) {
          if (typeof (dbString) === 'string') {
            var parseSuccess = false;
            try {
              self.loadJSON(dbString, options || {});
              parseSuccess = true;
            } catch (err) {
              cFun(err);
            }
            if (parseSuccess) {
              cFun(null);
              self.emit('loaded', 'database ' + self.filename + ' loaded');
            }
          } else {
            // falsy result means new database
            if (!dbString) {
              cFun(null);
              self.emit('loaded', 'empty database ' + self.filename + ' loaded');
              return;
            }

            // instanceof error means load faulted
            if (dbString instanceof Error) {
              cFun(dbString);
              return;
            }

            // if adapter has returned an js object (other than null or error) attempt to load from JSON object
            if (typeof (dbString) === "object") {
              self.loadJSONObject(dbString, options || {});
              cFun(null); // return null on success
              self.emit('loaded', 'database ' + self.filename + ' loaded');
              return;
            }

            cFun("unexpected adapter response : " + dbString);
          }
        });

      } else {
        cFun(new Error('persistenceAdapter not configured'));
      }
    };

    /**
     * Handles manually loading from file system, local storage, or adapter (such as indexeddb)
     *    This method utilizes loki configuration options (if provided) to determine which
     *    persistence method to use, or environment detection (if configuration was not provided).
     *    To avoid contention with any throttledSaves, we will drain the save queue first.
     *
     * If you are configured with autosave, you do not need to call this method yourself.
     *
     * @param {object} options - if throttling saves and loads, this controls how we drain save queue before loading
     * @param {boolean} options.recursiveWait - (default: true) wait recursively until no saves are queued
     * @param {bool} options.recursiveWaitLimit - (default: false) limit our recursive waiting to a duration
     * @param {int} options.recursiveWaitLimitDelay - (default: 2000) cutoff in ms to stop recursively re-draining
     * @param {function=} callback - (Optional) user supplied async callback / error handler
     * @memberof Loki
     * @example
     * db.loadDatabase({}, function(err) {
     *   if (err) {
     *     console.log("error : " + err);
     *   }
     *   else {
     *     console.log("database loaded.");
     *   }
     * });
     */
    Loki.prototype.loadDatabase = function (options, callback) {
      var self = this;

      // if throttling disabled, just call internal
      if (!this.throttledSaves) {
        this.loadDatabaseInternal(options, callback);
        return;
      }

      // try to drain any pending saves in the queue to lock it for loading
      this.throttledSaveDrain(function (success) {
        if (success) {
          // pause/throttle saving until loading is done
          self.throttledSavePending = true;

          self.loadDatabaseInternal(options, function (err) {
            // now that we are finished loading, if no saves were throttled, disable flag
            if (self.throttledCallbacks.length === 0) {
              self.throttledSavePending = false;
            }
            // if saves requests came in while loading, kick off new save to kick off resume saves
            else {
              self.saveDatabase();
            }

            if (typeof callback === 'function') {
              callback(err);
            }
          });
          return;
        }
        else {
          if (typeof callback === 'function') {
            callback(new Error("Unable to pause save throttling long enough to read database"));
          }
        }
      }, options);
    };

    /**
     * Internal save logic, decoupled from save throttling logic
     */
    Loki.prototype.saveDatabaseInternal = function (callback) {
      var cFun = callback || function (err) {
        if (err) {
          throw err;
        }
        return;
      };
      var self = this;

      // the persistenceAdapter should be present if all is ok, but check to be sure.
      if (!this.persistenceAdapter) {
        cFun(new Error('persistenceAdapter not configured'));
        return;
      }

      // run incremental, reference, or normal mode adapters, depending on what's available
      if (this.persistenceAdapter.mode === "incremental") {
        var cachedDirty;
        // ignore autosave until we copy loki (only then we can clear dirty flags,
        // but if we don't do it now, autosave will be triggered a lot unnecessarily)
        this.ignoreAutosave = true;
        this.persistenceAdapter.saveDatabase(
          this.filename,
          function getLokiCopy() {
            self.ignoreAutosave = false;
            if (cachedDirty) {
              cFun(new Error('adapter error - getLokiCopy called more than once'));
              return;
            }
            var lokiCopy = self.copy({ removeNonSerializable: true });

            // remember and clear dirty ids -- we must do it before the save so that if
            // and update occurs between here and callback, it will get saved later
            cachedDirty = self.collections.map(function (collection) {
              return [collection.dirty, collection.dirtyIds];
            });
            self.collections.forEach(function (col) {
              col.dirty = false;
              col.dirtyIds = [];
            });
            return lokiCopy;
          },
          function exportDatabaseCallback(err) {
            self.ignoreAutosave = false;
            if (err && cachedDirty) {
              // roll back dirty IDs to be saved later
              self.collections.forEach(function (col, i) {
                var cached = cachedDirty[i];
                col.dirty = col.dirty || cached[0];
                col.dirtyIds = col.dirtyIds.concat(cached[1]);
              });
            }
            cFun(err);
          });
      } else if (this.persistenceAdapter.mode === "reference" && typeof this.persistenceAdapter.exportDatabase === "function") {
        // TODO: dirty should be cleared here
        // filename may seem redundant but loadDatabase will need to expect this same filename
        this.persistenceAdapter.exportDatabase(this.filename, this.copy({ removeNonSerializable: true }), function exportDatabaseCallback(err) {
          self.autosaveClearFlags();
          cFun(err);
        });
      }
      // otherwise just pass the serialized database to adapter
      else {
        // persistenceAdapter might be asynchronous, so we must clear `dirty` immediately
        // or autosave won't work if an update occurs between here and the callback
        // TODO: This should be stored and rolled back in case of DB save failure
        this.autosaveClearFlags();
        this.persistenceAdapter.saveDatabase(this.filename, this.serialize(), function saveDatabasecallback(err) {
          cFun(err);
        });
      }
    };

    /**
     * Handles manually saving to file system, local storage, or adapter (such as indexeddb)
     *    This method utilizes loki configuration options (if provided) to determine which
     *    persistence method to use, or environment detection (if configuration was not provided).
     *
     * If you are configured with autosave, you do not need to call this method yourself.
     *
     * @param {function=} callback - (Optional) user supplied async callback / error handler
     * @memberof Loki
     * @example
     * db.saveDatabase(function(err) {
     *   if (err) {
     *     console.log("error : " + err);
     *   }
     *   else {
     *     console.log("database saved.");
     *   }
     * });
     */
    Loki.prototype.saveDatabase = function (callback) {
      if (!this.throttledSaves) {
        this.saveDatabaseInternal(callback);
        return;
      }

      if (this.throttledSavePending) {
        this.throttledCallbacks.push(callback);
        return;
      }

      var localCallbacks = this.throttledCallbacks;
      this.throttledCallbacks = [];
      localCallbacks.unshift(callback);
      this.throttledSavePending = true;

      var self = this;
      this.saveDatabaseInternal(function (err) {
        self.throttledSavePending = false;
        localCallbacks.forEach(function (pcb) {
          if (typeof pcb === 'function') {
            // Queue the callbacks so we first finish this method execution
            setTimeout(function () {
              pcb(err);
            }, 1);
          }
        });

        // since this is called async, future requests may have come in, if so.. kick off next save
        if (self.throttledCallbacks.length > 0) {
          self.saveDatabase();
        }
      });
    };

    // alias
    Loki.prototype.save = Loki.prototype.saveDatabase;

    /**
     * Handles deleting a database from file system, local
     *    storage, or adapter (indexeddb)
     *    This method utilizes loki configuration options (if provided) to determine which
     *    persistence method to use, or environment detection (if configuration was not provided).
     *
     * @param {function=} callback - (Optional) user supplied async callback / error handler
     * @memberof Loki
     */
    Loki.prototype.deleteDatabase = function (options, callback) {
      var cFun = callback || function (err, data) {
        if (err) {
          throw err;
        }
      };

      // we aren't even using options, so we will support syntax where
      // callback is passed as first and only argument
      if (typeof options === 'function' && !callback) {
        cFun = options;
      }

      // the persistenceAdapter should be present if all is ok, but check to be sure.
      if (this.persistenceAdapter !== null) {
        this.persistenceAdapter.deleteDatabase(this.filename, function deleteDatabaseCallback(err) {
          cFun(err);
        });
      } else {
        cFun(new Error('persistenceAdapter not configured'));
      }
    };

    /**
     * autosaveDirty - check whether any collections are 'dirty' meaning we need to save (entire) database
     *
     * @returns {boolean} - true if database has changed since last autosave, false if not.
     */
    Loki.prototype.autosaveDirty = function () {
      for (var idx = 0; idx < this.collections.length; idx++) {
        if (this.collections[idx].dirty) {
          return true;
        }
      }

      return false;
    };

    /**
     * autosaveClearFlags - resets dirty flags on all collections.
     *    Called from saveDatabase() after db is saved.
     *
     */
    Loki.prototype.autosaveClearFlags = function () {
      for (var idx = 0; idx < this.collections.length; idx++) {
        this.collections[idx].dirty = false;
      }
    };

    /**
     * autosaveEnable - begin a javascript interval to periodically save the database.
     *
     * @param {object} options - not currently used (remove or allow overrides?)
     * @param {function=} callback - (Optional) user supplied async callback
     */
    Loki.prototype.autosaveEnable = function (options, callback) {
      this.autosave = true;

      var delay = 5000,
        self = this;

      if (typeof (this.autosaveInterval) !== 'undefined' && this.autosaveInterval !== null) {
        delay = this.autosaveInterval;
      }

      this.autosaveHandle = setInterval(function autosaveHandleInterval() {
        // use of dirty flag will need to be hierarchical since mods are done at collection level with no visibility of 'db'
        // so next step will be to implement collection level dirty flags set on insert/update/remove
        // along with loki level isdirty() function which iterates all collections to see if any are dirty

        if (self.autosaveDirty() && !self.ignoreAutosave) {
          self.saveDatabase(callback);
        }
      }, delay);
    };

    /**
     * autosaveDisable - stop the autosave interval timer.
     *
     */
    Loki.prototype.autosaveDisable = function () {
      if (typeof (this.autosaveHandle) !== 'undefined' && this.autosaveHandle !== null) {
        clearInterval(this.autosaveHandle);
        this.autosaveHandle = null;
      }
    };


    /**
     * Resultset class allowing chainable queries.  Intended to be instanced internally.
     *    Collection.find(), Collection.where(), and Collection.chain() instantiate this.
     *
     * @example
     *    mycollection.chain()
     *      .find({ 'doors' : 4 })
     *      .where(function(obj) { return obj.name === 'Toyota' })
     *      .data();
     *
     * @constructor Resultset
     * @param {Collection} collection - The collection which this Resultset will query against.
     */
    function Resultset(collection, options) {
      options = options || {};

      // retain reference to collection we are querying against
      this.collection = collection;
      this.filteredrows = [];
      this.filterInitialized = false;

      return this;
    }

    /**
     * reset() - Reset the resultset to its initial state.
     *
     * @returns {Resultset} Reference to this resultset, for future chain operations.
     */
    Resultset.prototype.reset = function () {
      if (this.filteredrows.length > 0) {
        this.filteredrows = [];
      }
      this.filterInitialized = false;
      return this;
    };

    /**
     * toJSON() - Override of toJSON to avoid circular references
     *
     */
    Resultset.prototype.toJSON = function () {
      var copy = this.copy();
      copy.collection = null;
      return copy;
    };

    /**
     * Allows you to limit the number of documents passed to next chain operation.
     *    A resultset copy() is made to avoid altering original resultset.
     *
     * @param {int} qty - The number of documents to return.
     * @returns {Resultset} Returns a copy of the resultset, limited by qty, for subsequent chain ops.
     * @memberof Resultset
     * // find the two oldest users
     * var result = users.chain().simplesort("age", true).limit(2).data();
     */
    Resultset.prototype.limit = function (qty) {
      // if this has no filters applied, we need to populate filteredrows first
      if (!this.filterInitialized && this.filteredrows.length === 0) {
        this.filteredrows = this.collection.prepareFullDocIndex();
      }

      var rscopy = new Resultset(this.collection);
      rscopy.filteredrows = this.filteredrows.slice(0, qty);
      rscopy.filterInitialized = true;
      return rscopy;
    };

    /**
     * Used for skipping 'pos' number of documents in the resultset.
     *
     * @param {int} pos - Number of documents to skip; all preceding documents are filtered out.
     * @returns {Resultset} Returns a copy of the resultset, containing docs starting at 'pos' for subsequent chain ops.
     * @memberof Resultset
     * // find everyone but the two oldest users
     * var result = users.chain().simplesort("age", true).offset(2).data();
     */
    Resultset.prototype.offset = function (pos) {
      // if this has no filters applied, we need to populate filteredrows first
      if (!this.filterInitialized && this.filteredrows.length === 0) {
        this.filteredrows = this.collection.prepareFullDocIndex();
      }

      var rscopy = new Resultset(this.collection);
      rscopy.filteredrows = this.filteredrows.slice(pos);
      rscopy.filterInitialized = true;
      return rscopy;
    };

    /**
     * copy() - To support reuse of resultset in branched query situations.
     *
     * @returns {Resultset} Returns a copy of the resultset (set) but the underlying document references will be the same.
     * @memberof Resultset
     */
    Resultset.prototype.copy = function () {
      var result = new Resultset(this.collection);

      if (this.filteredrows.length > 0) {
        result.filteredrows = this.filteredrows.slice();
      }
      result.filterInitialized = this.filterInitialized;

      return result;
    };

    /**
     * Alias of copy()
     * @memberof Resultset
     */
    Resultset.prototype.branch = Resultset.prototype.copy;
    
// (Code skipped for WatermelonDB build)

    /**
     * User supplied compare function is provided two documents to compare. (chainable)
     * @example
     *    rslt.sort(function(obj1, obj2) {
     *      if (obj1.name === obj2.name) return 0;
     *      if (obj1.name > obj2.name) return 1;
     *      if (obj1.name < obj2.name) return -1;
     *    });
     *
     * @param {function} comparefun - A javascript compare function used for sorting.
     * @returns {Resultset} Reference to this resultset, sorted, for future chain operations.
     * @memberof Resultset
     */
    Resultset.prototype.sort = function (comparefun) {
      // if this has no filters applied, just we need to populate filteredrows first
      if (!this.filterInitialized && this.filteredrows.length === 0) {
        this.filteredrows = this.collection.prepareFullDocIndex();
      }

      var wrappedComparer =
        (function (userComparer, data) {
          return function (a, b) {
            return userComparer(data[a], data[b]);
          };
        })(comparefun, this.collection.data);

      this.filteredrows.sort(wrappedComparer);

      return this;
    };

    /**
     * Simpler, loose evaluation for user to sort based on a property name. (chainable).
     *    Sorting based on the same lt/gt helper functions used for binary indices.
     *
     * @param {string} propname - name of property to sort by.
     * @param {object|bool=} options - boolean to specify if isdescending, or options object
     * @param {boolean} [options.desc=false] - whether to sort descending
     * @param {boolean} [options.disableIndexIntersect=false] - whether we should explicity not use array intersection.
     * @param {boolean} [options.forceIndexIntersect=false] - force array intersection (if binary index exists).
     * @param {boolean} [options.useJavascriptSorting=false] - whether results are sorted via basic javascript sort.
     * @returns {Resultset} Reference to this resultset, sorted, for future chain operations.
     * @memberof Resultset
     * @example
     * var results = users.chain().simplesort('age').data();
     */
    Resultset.prototype.simplesort = function (propname, options) {
      var eff,
        targetEff = 10,
        dc = this.collection.data.length,
        frl = this.filteredrows.length,
        hasBinaryIndex = this.collection.binaryIndices.hasOwnProperty(propname);

      if (typeof (options) === 'undefined' || options === false) {
        options = { desc: false };
      }
      if (options === true) {
        options = { desc: true };
      }

      // if nothing in filtered rows array...
      if (frl === 0) {
        // if the filter is initialized to be empty resultset, do nothing
        if (this.filterInitialized) {
          return this;
        }

        // otherwise no filters applied implies all documents, so we need to populate filteredrows first

        // if we have a binary index, we can just use that instead of sorting (again)
        if (this.collection.binaryIndices.hasOwnProperty(propname)) {
          // make sure index is up-to-date
          this.collection.ensureIndex(propname);
          // copy index values into filteredrows
          this.filteredrows = this.collection.binaryIndices[propname].values.slice(0);

          if (options.desc) {
            this.filteredrows.reverse();
          }

          // we are done, return this (resultset) for further chain ops
          return this;
        }
        // otherwise initialize array for sort below
        else {
          // build full document index (to be sorted subsequently)
          this.filteredrows = this.collection.prepareFullDocIndex();
        }
      }
      // otherwise we had results to begin with, see if we qualify for index intercept optimization
      else {

        // If already filtered, but we want to leverage binary index on sort.
        // This will use custom array intection algorithm.
        if (!options.disableIndexIntersect && hasBinaryIndex) {

          // calculate filter efficiency
          eff = dc / frl;

          // when javascript sort fallback is enabled, you generally need more than ~17% of total docs in resultset
          // before array intersect is determined to be the faster algorithm, otherwise leave at 10% for loki sort.
          if (options.useJavascriptSorting) {
            targetEff = 6;
          }

          // anything more than ratio of 10:1 (total documents/current results) should use old sort code path
          // So we will only use array intersection if you have more than 10% of total docs in your current resultset.
          if (eff <= targetEff || options.forceIndexIntersect) {
            var idx, fr = this.filteredrows;
            var io = {};
            // set up hashobject for simple 'inclusion test' with existing (filtered) results
            for (idx = 0; idx < frl; idx++) {
              io[fr[idx]] = true;
            }
            // grab full sorted binary index array
            var pv = this.collection.binaryIndices[propname].values;

            // filter by existing results
            this.filteredrows = pv.filter(function (n) { return io[n]; });

            if (options.desc) {
              this.filteredrows.reverse();
            }

            return this;
          }
        }
      }

      // at this point, we will not be able to leverage binary index so we will have to do an array sort

      // if we have opted to use simplified javascript comparison function...
      if (options.useJavascriptSorting) {
        return this.sort(function (obj1, obj2) {
          if (obj1[propname] === obj2[propname]) return 0;
          if (obj1[propname] > obj2[propname]) return 1;
          if (obj1[propname] < obj2[propname]) return -1;
        });
      }

      // otherwise use loki sort which will return same results if column is indexed or not
      var wrappedComparer =
        (function (prop, desc, data) {
          var val1, val2, arr;
          return function (a, b) {
            if (~prop.indexOf('.')) {
              arr = prop.split('.');
              val1 = Utils.getIn(data[a], arr, true);
              val2 = Utils.getIn(data[b], arr, true);
            } else {
              val1 = data[a][prop];
              val2 = data[b][prop];
            }
            return sortHelper(val1, val2, desc);
          };
        })(propname, options.desc, this.collection.data);

      this.filteredrows.sort(wrappedComparer);

      return this;
    };

    /**
     * Allows sorting a resultset based on multiple columns.
     * @example
     * // to sort by age and then name (both ascending)
     * rs.compoundsort(['age', 'name']);
     * // to sort by age (ascending) and then by name (descending)
     * rs.compoundsort(['age', ['name', true]]);
     *
     * @param {array} properties - array of property names or subarray of [propertyname, isdesc] used evaluate sort order
     * @returns {Resultset} Reference to this resultset, sorted, for future chain operations.
     * @memberof Resultset
     */
    Resultset.prototype.compoundsort = function (properties) {
      if (properties.length === 0) {
        throw new Error("Invalid call to compoundsort, need at least one property");
      }

      var prop;
      if (properties.length === 1) {
        prop = properties[0];
        if (Array.isArray(prop)) {
          return this.simplesort(prop[0], prop[1]);
        }
        return this.simplesort(prop, false);
      }

      // unify the structure of 'properties' to avoid checking it repeatedly while sorting
      for (var i = 0, len = properties.length; i < len; i += 1) {
        prop = properties[i];
        if (!Array.isArray(prop)) {
          properties[i] = [prop, false];
        }
      }

      // if this has no filters applied, just we need to populate filteredrows first
      if (!this.filterInitialized && this.filteredrows.length === 0) {
        this.filteredrows = this.collection.prepareFullDocIndex();
      }

      var wrappedComparer =
        (function (props, data) {
          return function (a, b) {
            return compoundeval(props, data[a], data[b]);
          };
        })(properties, this.collection.data);

      this.filteredrows.sort(wrappedComparer);

      return this;
    };

    /**
     * findOr() - oversee the operation of OR'ed query expressions.
     *    OR'ed expression evaluation runs each expression individually against the full collection,
     *    and finally does a set OR on each expression's results.
     *    Each evaluation can utilize a binary index to prevent multiple linear array scans.
     *
     * @param {array} expressionArray - array of expressions
     * @returns {Resultset} this resultset for further chain ops.
     */
    Resultset.prototype.findOr = function (expressionArray) {
      var fr = null,
        fri = 0,
        frlen = 0,
        docset = [],
        idxset = [],
        idx = 0,
        origCount = this.count();

      // If filter is already initialized, then we query against only those items already in filter.
      // This means no index utilization for fields, so hopefully its filtered to a smallish filteredrows.
      for (var ei = 0, elen = expressionArray.length; ei < elen; ei++) {
        // we need to branch existing query to run each filter separately and combine results
        fr = this.branch().find(expressionArray[ei]).filteredrows;
        frlen = fr.length;

        // add any document 'hits'
        for (fri = 0; fri < frlen; fri++) {
          idx = fr[fri];
          if (idxset[idx] === undefined) {
            idxset[idx] = true;
            docset.push(idx);
          }
        }
      }

      this.filteredrows = docset;
      this.filterInitialized = true;

      return this;
    };
    Resultset.prototype.$or = Resultset.prototype.findOr;

    // precompile recursively
    function precompileQuery(operator, value) {
      // for regex ops, precompile
      if (operator === '$regex') {
        if (Array.isArray(value)) {
          value = new RegExp(value[0], value[1]);
        } else if (!(value instanceof RegExp)) {
          value = new RegExp(value);
        }
      }
      else if (typeof value === 'object') {
        for (var key in value) {
          if (key === '$regex' || typeof value[key] === 'object') {
            value[key] = precompileQuery(key, value[key]);
          }
        }
      }

      return value;
    }

    /**
     * findAnd() - oversee the operation of AND'ed query expressions.
     *    AND'ed expression evaluation runs each expression progressively against the full collection,
     *    internally utilizing existing chained resultset functionality.
     *    Only the first filter can utilize a binary index.
     *
     * @param {array} expressionArray - array of expressions
     * @returns {Resultset} this resultset for further chain ops.
     */
    Resultset.prototype.findAnd = function (expressionArray) {
      // we have already implementing method chaining in this (our Resultset class)
      // so lets just progressively apply user supplied and filters
      for (var i = 0, len = expressionArray.length; i < len; i++) {
        if (this.count() === 0) {
          return this;
        }
        this.find(expressionArray[i]);
      }
      return this;
    };
    Resultset.prototype.$and = Resultset.prototype.findAnd;

    /**
     * Used for querying via a mongo-style query object.
     *
     * @param {object} query - A mongo-style query object used for filtering current results.
     * @param {boolean=} firstOnly - (Optional) Used by collection.findOne()
     * @returns {Resultset} this resultset for further chain ops.
     * @memberof Resultset
     * @example
     * var over30 = users.chain().find({ age: { $gte: 30 } }).data();
     */
    Resultset.prototype.find = function (query, firstOnly) {
      if (this.collection.data.length === 0) {
        this.filteredrows = [];
        this.filterInitialized = true;
        return this;
      }

      var queryObject = query || 'getAll',
        p,
        property,
        queryObjectOp,
        obj,
        operator,
        value,
        key,
        searchByIndex = false,
        result = [],
        filters = [],
        index = null;

      // flag if this was invoked via findOne()
      firstOnly = firstOnly || false;

      if (typeof queryObject === 'object') {
        for (p in queryObject) {
          obj = {};
          obj[p] = queryObject[p];
          filters.push(obj);

          if (hasOwnProperty.call(queryObject, p)) {
            property = p;
            queryObjectOp = queryObject[p];
          }
        }
        // if more than one expression in single query object,
        // convert implicit $and to explicit $and
        if (filters.length > 1) {
          return this.find({ '$and': filters }, firstOnly);
        }
      }

      // apply no filters if they want all
      if (!property || queryObject === 'getAll') {
        if (firstOnly) {
          if (this.filterInitialized) {
            this.filteredrows = this.filteredrows.slice(0, 1);
          } else {
            this.filteredrows = (this.collection.data.length > 0) ? [0] : [];
            this.filterInitialized = true;
          }
        }

        return this;
      }

      // injecting $and and $or expression tree evaluation here.
      if (property === '$and' || property === '$or') {
        this[property](queryObjectOp);

        // for chained find with firstonly,
        if (firstOnly && this.filteredrows.length > 1) {
          this.filteredrows = this.filteredrows.slice(0, 1);
        }

        return this;
      }

      // see if query object is in shorthand mode (assuming eq operator)
      if (queryObjectOp === null || (typeof queryObjectOp !== 'object' || queryObjectOp instanceof Date)) {
        operator = '$eq';
        value = queryObjectOp;
      } else if (typeof queryObjectOp === 'object') {
        for (key in queryObjectOp) {
          if (hasOwnProperty.call(queryObjectOp, key)) {
            operator = key;
            value = queryObjectOp[key];
            break;
          }
        }
      } else {
        throw new Error('Do not know what you want to do.');
      }

      if (operator === '$regex' || typeof value === 'object') {
        value = precompileQuery(operator, value);
      }

      // if user is deep querying the object such as find('name.first': 'odin')
      var usingDotNotation = (property.indexOf('.') !== -1);

      // if an index exists for the property being queried against, use it
      // for now only enabling where it is the first filter applied and prop is indexed
      var doIndexCheck = !this.filterInitialized;

      if (doIndexCheck && this.collection.binaryIndices[property] && indexedOps[operator]) {
        // this is where our lazy index rebuilding will take place
        // basically we will leave all indexes dirty until we need them
        // so here we will rebuild only the index tied to this property
        // ensureIndex() will only rebuild if flagged as dirty since we are not passing force=true param
        if (this.collection.adaptiveBinaryIndices !== true) {
          this.collection.ensureIndex(property);
        }

        searchByIndex = true;
        index = this.collection.binaryIndices[property];
      }

      // opportunistically speed up $in searches from O(n*m) to O(n*log m)
      if (!searchByIndex && operator === '$in' && Array.isArray(value) && typeof Set !== 'undefined') {
        value = new Set(value);
        operator = '$inSet';
      }

      // the comparison function
      var fun = LokiOps[operator];

      // "shortcut" for collection data
      var t = this.collection.data;
      // filter data length
      var i = 0,
        len = 0;

      // Query executed differently depending on :
      //    - whether the property being queried has an index defined
      //    - if chained, we handle first pass differently for initial filteredrows[] population
      //
      // For performance reasons, each case has its own if block to minimize in-loop calculations

      var filter, rowIdx = 0, record;

      // If the filteredrows[] is already initialized, use it
      if (this.filterInitialized) {
        filter = this.filteredrows;
        len = filter.length;

        // currently supporting dot notation for non-indexed conditions only
        if (usingDotNotation) {
          property = property.split('.');
          for (i = 0; i < len; i++) {
            rowIdx = filter[i];
            record = t[rowIdx];
            if (dotSubScan(record, property, fun, value, record)) {
              result.push(rowIdx);
              if (firstOnly) {
                this.filteredrows = result;
                return this;
              }
            }
          }
        } else {
          for (i = 0; i < len; i++) {
            rowIdx = filter[i];
            record = t[rowIdx];
            if (fun(record[property], value, record)) {
              result.push(rowIdx);
              if (firstOnly) {
                this.filteredrows = result;
                return this;
              }
            }
          }
        }
      }
      // first chained query so work against data[] but put results in filteredrows
      else {
        // if not searching by index
        if (!searchByIndex) {
          len = t.length;

          if (usingDotNotation) {
            property = property.split('.');
            for (i = 0; i < len; i++) {
              record = t[i];
              if (dotSubScan(record, property, fun, value, record)) {
                result.push(i);
                if (firstOnly) {
                  this.filteredrows = result;
                  this.filterInitialized = true;
                  return this;
                }
              }
            }
          } else {
            for (i = 0; i < len; i++) {
              record = t[i];
              if (fun(record[property], value, record)) {
                result.push(i);
                if (firstOnly) {
                  this.filteredrows = result;
                  this.filterInitialized = true;
                  return this;
                }
              }
            }
          }
        } else {
          // search by index
          var segm = this.collection.calculateRange(operator, property, value);

          if (operator !== '$in') {
            for (i = segm[0]; i <= segm[1]; i++) {
              if (indexedOps[operator] !== true) {
                // must be a function, implying 2nd phase filtering of results from calculateRange
                if (indexedOps[operator](Utils.getIn(t[index.values[i]], property, usingDotNotation), value)) {
                  result.push(index.values[i]);
                  if (firstOnly) {
                    this.filteredrows = result;
                    this.filterInitialized = true;
                    return this;
                  }
                }
              }
              else {
                result.push(index.values[i]);
                if (firstOnly) {
                  this.filteredrows = result;
                  this.filterInitialized = true;
                  return this;
                }
              }
            }
          } else {
            for (i = 0, len = segm.length; i < len; i++) {
              result.push(index.values[segm[i]]);
              if (firstOnly) {
                this.filteredrows = result;
                this.filterInitialized = true;
                return this;
              }
            }
          }
        }

      }

      this.filteredrows = result;
      this.filterInitialized = true; // next time work against filteredrows[]
      return this;
    };


    /**
     * where() - Used for filtering via a javascript filter function.
     *
     * @param {function} fun - A javascript function used for filtering current results by.
     * @returns {Resultset} this resultset for further chain ops.
     * @memberof Resultset
     * @example
     * var over30 = users.chain().where(function(obj) { return obj.age >= 30; }.data();
     */
    Resultset.prototype.where = function (fun) {
      var viewFunction,
        result = [];

      if ('function' === typeof fun) {
        viewFunction = fun;
      } else {
        throw new TypeError('Argument is not a stored view or a function');
      }
      try {
        // If the filteredrows[] is already initialized, use it
        if (this.filterInitialized) {
          var j = this.filteredrows.length;

          while (j--) {
            if (viewFunction(this.collection.data[this.filteredrows[j]]) === true) {
              result.push(this.filteredrows[j]);
            }
          }

          this.filteredrows = result;

          return this;
        }
        // otherwise this is initial chained op, work against data, push into filteredrows[]
        else {
          var k = this.collection.data.length;

          while (k--) {
            if (viewFunction(this.collection.data[k]) === true) {
              result.push(k);
            }
          }

          this.filteredrows = result;
          this.filterInitialized = true;

          return this;
        }
      } catch (err) {
        throw err;
      }
    };

    /**
     * count() - returns the number of documents in the resultset.
     *
     * @returns {number} The number of documents in the resultset.
     * @memberof Resultset
     * @example
     * var over30Count = users.chain().find({ age: { $gte: 30 } }).count();
     */
    Resultset.prototype.count = function () {
      if (this.filterInitialized) {
        return this.filteredrows.length;
      }
      return this.collection.count();
    };

    /**
     * Terminates the chain and returns array of filtered documents
     *
     * @param {object=} options - allows specifying 'forceClones' and 'forceCloneMethod' options.
     * @param {boolean} options.forceClones - Allows forcing the return of cloned objects even when
     *        the collection is not configured for clone object.
     * @param {string} options.forceCloneMethod - Allows overriding the default or collection specified cloning method.
     *        Possible values include 'parse-stringify', 'jquery-extend-deep', 'shallow', 'shallow-assign'
     * @param {bool} options.removeMeta - Will force clones and strip $loki and meta properties from documents
     *
     * @returns {array} Array of documents in the resultset
     * @memberof Resultset
     * @example
     * var resutls = users.chain().find({ age: 34 }).data();
     */
    Resultset.prototype.data = function (options) {
      var result = [],
        data = this.collection.data,
        obj,
        len,
        i,
        method;

      options = options || {};

      // if user opts to strip meta, then force clones and use 'shallow' if 'force' options are not present
      if (options.removeMeta && !options.forceClones) {
        options.forceClones = true;
        options.forceCloneMethod = options.forceCloneMethod || 'shallow';
      }

      // if collection has delta changes active, then force clones and use 'parse-stringify' for effective change tracking of nested objects
      // if collection is immutable freeze and unFreeze takes care of cloning
      if (!this.collection.disableDeltaChangesApi && this.collection.disableFreeze) {
        options.forceClones = true;
        options.forceCloneMethod = 'parse-stringify';
      }

      // if this has no filters applied, just return collection.data
      if (!this.filterInitialized) {
        if (this.filteredrows.length === 0) {
          // determine whether we need to clone objects or not
          if (this.collection.cloneObjects || options.forceClones) {
            len = data.length;
            method = options.forceCloneMethod || this.collection.cloneMethod;
            for (i = 0; i < len; i++) {
              obj = clone(data[i], method);
              if (options.removeMeta) {
                delete obj.$loki;
                delete obj.meta;
              }
              result.push(obj);
            }
            return result;
          }
          // otherwise we are not cloning so return sliced array with same object references
          else {
            return data.slice();
          }
        } else {
          // filteredrows must have been set manually, so use it
          this.filterInitialized = true;
        }
      }

      var fr = this.filteredrows;
      len = fr.length;

      if (this.collection.cloneObjects || options.forceClones) {
        method = options.forceCloneMethod || this.collection.cloneMethod;
        for (i = 0; i < len; i++) {
          obj = clone(data[fr[i]], method);
          if (options.removeMeta) {
            delete obj.$loki;
            delete obj.meta;
          }
          result.push(obj);
        }
      } else {
        for (i = 0; i < len; i++) {
          result.push(data[fr[i]]);
        }
      }
      return result;
    };

    /**
     * Used to run an update operation on all documents currently in the resultset.
     *
     * @param {function} updateFunction - User supplied updateFunction(obj) will be executed for each document object.
     * @returns {Resultset} this resultset for further chain ops.
     * @memberof Resultset
     * @example
     * users.chain().find({ country: 'de' }).update(function(user) {
     *   user.phoneFormat = "+49 AAAA BBBBBB";
     * });
     */
    Resultset.prototype.update = function (updateFunction) {

      if (typeof (updateFunction) !== "function") {
        throw new TypeError('Argument is not a function');
      }

      // if this has no filters applied, we need to populate filteredrows first
      if (!this.filterInitialized && this.filteredrows.length === 0) {
        this.filteredrows = this.collection.prepareFullDocIndex();
      }

      var obj, len = this.filteredrows.length,
        rcd = this.collection.data;

      // pass in each document object currently in resultset to user supplied updateFunction
      for (var idx = 0; idx < len; idx++) {
        // if we have cloning option specified or are doing differential delta changes, clone object first
        if (!this.disableFreeze || this.collection.cloneObjects || !this.collection.disableDeltaChangesApi) {
          obj = clone(rcd[this.filteredrows[idx]], this.collection.cloneMethod);
          updateFunction(obj);
          this.collection.update(obj);
        }
        else {
          // no need to clone, so just perform update on collection data object instance
          updateFunction(rcd[this.filteredrows[idx]]);
          this.collection.update(rcd[this.filteredrows[idx]]);
        }
      }

      return this;
    };

    /**
     * Removes all document objects which are currently in resultset from collection (as well as resultset)
     *
     * @returns {Resultset} this (empty) resultset for further chain ops.
     * @memberof Resultset
     * @example
     * // remove users inactive since 1/1/2001
     * users.chain().find({ lastActive: { $lte: new Date("1/1/2001").getTime() } }).remove();
     */
    Resultset.prototype.remove = function () {

      // if this has no filters applied, we need to populate filteredrows first
      if (!this.filterInitialized && this.filteredrows.length === 0) {
        this.filteredrows = this.collection.prepareFullDocIndex();
      }

      this.collection.removeBatchByPositions(this.filteredrows);

      this.filteredrows = [];

      return this;
    };
    
// (Code skipped for WatermelonDB build)

    /**
     * Applies a map function into a new collection for further chaining.
     * @param {function} mapFun - javascript map function
     * @param {object=} dataOptions - options to data() before input to your map function
     * @param {bool} dataOptions.removeMeta - allows removing meta before calling mapFun
     * @param {boolean} dataOptions.forceClones - forcing the return of cloned objects to your map object
     * @param {string} dataOptions.forceCloneMethod - Allows overriding the default or collection specified cloning method.
     * @memberof Resultset
     * @example
     * var orders.chain().find({ productId: 32 }).map(function(obj) {
     *   return {
     *     orderId: $loki,
     *     productId: productId,
     *     quantity: qty
     *   };
     * });
     */
    Resultset.prototype.map = function (mapFun, dataOptions) {
      var data = this.data(dataOptions).map(mapFun);
      //return return a new resultset with no filters
      this.collection = new Collection('mappedData');
      this.collection.insert(data);
      this.filteredrows = [];
      this.filterInitialized = false;

      return this;
    };
    
// (Code skipped for WatermelonDB build)


    /**
     * Collection class that handles documents of same type
     * @constructor Collection
     * @implements LokiEventEmitter
     * @param {string} name - collection name
     * @param {(array|object)=} options - (optional) array of property names to be indicized OR a configuration object
     * @param {array=} [options.unique=[]] - array of property names to define unique constraints for
     * @param {array=} [options.exact=[]] - array of property names to define exact constraints for
     * @param {array=} [options.indices=[]] - array property names to define binary indexes for
     * @param {boolean} [options.adaptiveBinaryIndices=true] - collection indices will be actively rebuilt rather than lazily
     * @param {boolean} [options.asyncListeners=false] - whether listeners are invoked asynchronously
     * @param {boolean} [options.disableMeta=false] - set to true to disable meta property on documents
     * @param {boolean} [options.disableChangesApi=true] - set to false to enable Changes API
     * @param {boolean} [options.disableDeltaChangesApi=true] - set to false to enable Delta Changes API (requires Changes API, forces cloning)
     * @param {boolean} [options.autoupdate=false] - use Object.observe to update objects automatically
     * @param {boolean} [options.clone=false] - specify whether inserts and queries clone to/from user
     * @param {boolean} [options.serializableIndices=true[]] - converts date values on binary indexed properties to epoch time
     * @param {boolean} [options.disableFreeze=true] - when false all docs are frozen
     * @param {string} [options.cloneMethod='parse-stringify'] - 'parse-stringify', 'jquery-extend-deep', 'shallow', 'shallow-assign'
     * @param {int=} options.ttl - age of document (in ms.) before document is considered aged/stale.
     * @param {int=} options.ttlInterval - time interval for clearing out 'aged' documents; not set by default.
     * @see {@link Loki#addCollection} for normal creation of collections
     */
    function Collection(name, options) {
      // the name of the collection

      this.name = name;
      // the data held by the collection
      this.data = [];
      this.idIndex = null; // position->$loki index (built lazily)
      this.binaryIndices = {}; // user defined indexes
      this.constraints = {
        unique: {},
        exact: {}
      };

      // unique contraints contain duplicate object references, so they are not persisted.
      // we will keep track of properties which have unique contraint applied here, and regenerate lazily
      this.uniqueNames = [];

      // transforms will be used to store frequently used query chains as a series of steps
      // which itself can be stored along with the database.
      this.transforms = {};

      // the object type of the collection
      this.objType = name;

      // in autosave scenarios we will use collection level dirty flags to determine whether save is needed.
      // currently, if any collection is dirty we will autosave the whole database if autosave is configured.
      // defaulting to true since this is called from addCollection and adding a collection should trigger save
      this.dirty = true;

      // private holders for cached data
      this.cachedIndex = null;
      this.cachedBinaryIndex = null;
      this.cachedData = null;
      var self = this;

      /* OPTIONS */
      options = options || {};

      // exact match and unique constraints
      if (options.hasOwnProperty('unique')) {
        if (!Array.isArray(options.unique)) {
          options.unique = [options.unique];
        }
        // save names; actual index is built lazily
        options.unique.forEach(function (prop) {
          self.uniqueNames.push(prop);
        });
      }

      
// (Code skipped for WatermelonDB build)


      // if set to true we will optimally keep indices 'fresh' during insert/update/remove ops (never dirty/never needs rebuild)
      // if you frequently intersperse insert/update/remove ops between find ops this will likely be significantly faster option.
      this.adaptiveBinaryIndices = options.hasOwnProperty('adaptiveBinaryIndices') ? options.adaptiveBinaryIndices : true;

      // is collection transactional
      this.transactional = options.hasOwnProperty('transactional') ? options.transactional : false;

      // options to clone objects when inserting them
      this.cloneObjects = options.hasOwnProperty('clone') ? options.clone : false;

      // default clone method (if enabled) is parse-stringify
      this.cloneMethod = options.hasOwnProperty('cloneMethod') ? options.cloneMethod : "parse-stringify";

      // option to make event listeners async, default is sync
      this.asyncListeners = options.hasOwnProperty('asyncListeners') ? options.asyncListeners : false;

      // if set to true we will not maintain a meta property for a document
      this.disableMeta = options.hasOwnProperty('disableMeta') ? options.disableMeta : false;

      // disable track changes
      this.disableChangesApi = options.hasOwnProperty('disableChangesApi') ? options.disableChangesApi : true;

      // disable delta update object style on changes
      this.disableDeltaChangesApi = options.hasOwnProperty('disableDeltaChangesApi') ? options.disableDeltaChangesApi : true;
      if (this.disableChangesApi) { this.disableDeltaChangesApi = true; }

      // option to observe objects and update them automatically, ignored if Object.observe is not supported
      this.autoupdate = options.hasOwnProperty('autoupdate') ? options.autoupdate : false;

      // by default, if you insert a document into a collection with binary indices, if those indexed properties contain
      // a DateTime we will convert to epoch time format so that (across serializations) its value position will be the
      // same 'after' serialization as it was 'before'.
      this.serializableIndices = options.hasOwnProperty('serializableIndices') ? options.serializableIndices : true;

      // option to deep freeze all documents
      this.disableFreeze = options.hasOwnProperty('disableFreeze') ? options.disableFreeze : true;

      
// (Code skipped for WatermelonDB build)


      // currentMaxId - change manually at your own peril!
      this.maxId = 0;

      this.DynamicViews = [];

      // events
      this.events = {
        'insert': [],
        'update': [],
        'pre-insert': [],
        'pre-update': [],
        'close': [],
        'flushbuffer': [],
        'error': [],
        'delete': [],
        'warning': []
      };

      // changes are tracked by collection and aggregated by the db
      this.changes = [];

      // lightweight changes tracking (loki IDs only) for optimized db saving
      this.dirtyIds = [];

      // initialize optional user-supplied indices array ['age', 'lname', 'zip']
      var indices = [];
      if (options && options.indices) {
        if (Object.prototype.toString.call(options.indices) === '[object Array]') {
          indices = options.indices;
        } else if (typeof options.indices === 'string') {
          indices = [options.indices];
        } else {
          throw new TypeError('Indices needs to be a string or an array of strings');
        }
      }

      for (var idx = 0; idx < indices.length; idx++) {
        this.ensureIndex(indices[idx]);
      }

      
// (Code skipped for WatermelonDB build)


      this.on('warning', function (warning) {
        self.lokiConsoleWrapper.warn(warning);
      });
      
// (Code skipped for WatermelonDB build)

    }

    Collection.prototype = new LokiEventEmitter();
    Collection.prototype.contructor = Collection;
    
// (Code skipped for WatermelonDB build)

    Collection.prototype.lokiConsoleWrapper = {
      log: function () { },
      warn: function () { },
      error: function () { },
    };

    Collection.prototype.addAutoUpdateObserver = function (object) {
      
// (Code skipped for WatermelonDB build)

    };

    Collection.prototype.removeAutoUpdateObserver = function (object) {
      
// (Code skipped for WatermelonDB build)

    };

    
// (Code skipped for WatermelonDB build)

    /*----------------------------+
    | INDEXING                    |
    +----------------------------*/

    /**
     * create a row filter that covers all documents in the collection
     */
    Collection.prototype.prepareFullDocIndex = function () {
      var len = this.data.length;
      var indexes = new Array(len);
      for (var i = 0; i < len; i += 1) {
        indexes[i] = i;
      }
      return indexes;
    };

    /**
     * Will allow reconfiguring certain collection options.
     * @param {boolean} options.adaptiveBinaryIndices - collection indices will be actively rebuilt rather than lazily
     * @memberof Collection
     */
    Collection.prototype.configureOptions = function (options) {
      options = options || {};

      if (options.hasOwnProperty('adaptiveBinaryIndices')) {
        this.adaptiveBinaryIndices = options.adaptiveBinaryIndices;

        // if switching to adaptive binary indices, make sure none are 'dirty'
        if (this.adaptiveBinaryIndices) {
          this.ensureAllIndexes();
        }
      }
    };

    /**
     * Ensure binary index on a certain field
     * @param {string} property - name of property to create binary index on
     * @param {boolean=} force - (Optional) flag indicating whether to construct index immediately
     * @memberof Collection
     */
    Collection.prototype.ensureIndex = function (property, force) {
      // optional parameter to force rebuild whether flagged as dirty or not
      if (typeof (force) === 'undefined') {
        force = false;
      }

      if (property === null || property === undefined) {
        throw new Error('Attempting to set index without an associated property');
      }

      if (this.binaryIndices[property] && !force) {
        if (!this.binaryIndices[property].dirty) return;
      }

      // if the index is already defined and we are using adaptiveBinaryIndices and we are not forcing a rebuild, return.
      if (this.adaptiveBinaryIndices === true && this.binaryIndices.hasOwnProperty(property) && !force) {
        return;
      }

      var index = {
        'name': property,
        'dirty': true,
        'values': this.prepareFullDocIndex()
      };
      this.binaryIndices[property] = index;

      var wrappedComparer =
        (function (prop, data) {
          var val1, val2;
          var propPath = ~prop.indexOf('.') ? prop.split('.') : false;
          return function (a, b) {
            if (propPath) {
              val1 = Utils.getIn(data[a], propPath, true);
              val2 = Utils.getIn(data[b], propPath, true);
            } else {
              val1 = data[a][prop];
              val2 = data[b][prop];
            }

            if (val1 !== val2) {
              if (Comparators.lt(val1, val2, false)) return -1;
              if (Comparators.gt(val1, val2, false)) return 1;
            }
            return 0;
          };
        })(property, this.data);

      index.values.sort(wrappedComparer);
      index.dirty = false;

      this.dirty = true; // for autosave scenarios
    };

    /**
     * Perform checks to determine validity/consistency of all binary indices
     * @param {object=} options - optional configuration object
     * @param {boolean} [options.randomSampling=false] - whether (faster) random sampling should be used
     * @param {number} [options.randomSamplingFactor=0.10] - percentage of total rows to randomly sample
     * @param {boolean} [options.repair=false] - whether to fix problems if they are encountered
     * @returns {string[]} array of index names where problems were found.
     * @memberof Collection
     * @example
     * // check all indices on a collection, returns array of invalid index names
     * var result = coll.checkAllIndexes({ repair: true, randomSampling: true, randomSamplingFactor: 0.15 });
     * if (result.length > 0) {
     *   results.forEach(function(name) {
     *     console.log('problem encountered with index : ' + name);
     *   });
     * }
     */
    Collection.prototype.checkAllIndexes = function (options) {
      var key, bIndices = this.binaryIndices;
      var results = [], result;

      for (key in bIndices) {
        if (hasOwnProperty.call(bIndices, key)) {
          result = this.checkIndex(key, options);
          if (!result) {
            results.push(key);
          }
        }
      }

      return results;
    };

    /**
     * Perform checks to determine validity/consistency of a binary index
     * @param {string} property - name of the binary-indexed property to check
     * @param {object=} options - optional configuration object
     * @param {boolean} [options.randomSampling=false] - whether (faster) random sampling should be used
     * @param {number} [options.randomSamplingFactor=0.10] - percentage of total rows to randomly sample
     * @param {boolean} [options.repair=false] - whether to fix problems if they are encountered
     * @returns {boolean} whether the index was found to be valid (before optional correcting).
     * @memberof Collection
     * @example
     * // full test
     * var valid = coll.checkIndex('name');
     * // full test with repair (if issues found)
     * valid = coll.checkIndex('name', { repair: true });
     * // random sampling (default is 10% of total document count)
     * valid = coll.checkIndex('name', { randomSampling: true });
     * // random sampling (sample 20% of total document count)
     * valid = coll.checkIndex('name', { randomSampling: true, randomSamplingFactor: 0.20 });
     * // random sampling (implied boolean)
     * valid = coll.checkIndex('name', { randomSamplingFactor: 0.20 });
     * // random sampling with repair (if issues found)
     * valid = coll.checkIndex('name', { repair: true, randomSampling: true });
     */
    Collection.prototype.checkIndex = function (property, options) {
      options = options || {};
      // if 'randomSamplingFactor' specified but not 'randomSampling', assume true
      if (options.randomSamplingFactor && options.randomSampling !== false) {
        options.randomSampling = true;
      }
      options.randomSamplingFactor = options.randomSamplingFactor || 0.1;
      if (options.randomSamplingFactor < 0 || options.randomSamplingFactor > 1) {
        options.randomSamplingFactor = 0.1;
      }

      var valid = true, idx, iter, pos, len, biv;

      // make sure we are passed a valid binary index name
      if (!this.binaryIndices.hasOwnProperty(property)) {
        throw new Error("called checkIndex on property without an index: " + property);
      }

      // if lazy indexing, rebuild only if flagged as dirty
      if (!this.adaptiveBinaryIndices) {
        this.ensureIndex(property);
      }

      biv = this.binaryIndices[property].values;
      len = biv.length;

      // if the index has an incorrect number of values
      if (len !== this.data.length) {
        if (options.repair) {
          this.ensureIndex(property, true);
        }
        return false;
      }

      if (len === 0) {
        return true;
      }

      var usingDotNotation = (property.indexOf('.') !== -1);

      if (len === 1) {
        valid = (biv[0] === 0);
      }
      else {
        if (options.randomSampling) {
          // validate first and last
          if (!LokiOps.$lte(Utils.getIn(this.data[biv[0]], property, usingDotNotation),
            Utils.getIn(this.data[biv[1]], property, usingDotNotation))) {
            valid = false;
          }
          if (!LokiOps.$lte(Utils.getIn(this.data[biv[len - 2]], property, usingDotNotation),
            Utils.getIn(this.data[biv[len - 1]], property, usingDotNotation))) {
            valid = false;
          }

          // if first and last positions are sorted correctly with their nearest neighbor,
          // continue onto random sampling phase...
          if (valid) {
            // # random samplings = total count * sampling factor
            iter = Math.floor((len - 1) * options.randomSamplingFactor);

            // for each random sampling, validate that the binary index is sequenced properly
            // with next higher value.
            for (idx = 0; idx < iter - 1; idx++) {
              // calculate random position
              pos = Math.floor(Math.random() * (len - 1));
              if (!LokiOps.$lte(Utils.getIn(this.data[biv[pos]], property, usingDotNotation),
                Utils.getIn(this.data[biv[pos + 1]], property, usingDotNotation))) {
                valid = false;
                break;
              }
            }
          }
        }
        else {
          // validate that the binary index is sequenced properly
          for (idx = 0; idx < len - 1; idx++) {
            if (!LokiOps.$lte(Utils.getIn(this.data[biv[idx]], property, usingDotNotation),
              Utils.getIn(this.data[biv[idx + 1]], property, usingDotNotation))) {
              valid = false;
              break;
            }
          }
        }
      }

      // if incorrectly sequenced and we are to fix problems, rebuild index
      if (!valid && options.repair) {
        this.ensureIndex(property, true);
      }

      return valid;
    };

    Collection.prototype.getBinaryIndexValues = function (property) {
      var idx, idxvals = this.binaryIndices[property].values;
      var result = [];

      for (idx = 0; idx < idxvals.length; idx++) {
        result.push(Utils.getIn(this.data[idxvals[idx]], property, true));
      }

      return result;
    };

    /**
     * Returns a named unique index
     * @param {string} field - indexed field name
     * @param {boolean} force - if `true`, will rebuild index; otherwise, function may return null
     */
    Collection.prototype.getUniqueIndex = function (field, force) {
      var index = this.constraints.unique[field];
      if (!index && force) {
        return this.ensureUniqueIndex(field);
      }
      return index;
    };

    Collection.prototype.ensureUniqueIndex = function (field) {
      var index = this.constraints.unique[field];
      if (!index) {
        // keep track of new unique index for regenerate after database (re)load.
        if (this.uniqueNames.indexOf(field) == -1) {
          this.uniqueNames.push(field);
        }
      }

      // if index already existed, (re)loading it will likely cause collisions, rebuild always
      this.constraints.unique[field] = index = new UniqueIndex(field);
      this.data.forEach(function (obj) {
        index.set(obj);
      });
      return index;
    };

    /**
     * Ensure all binary indices
     * @param {boolean} force - whether to force rebuild of existing lazy binary indices
     * @memberof Collection
     */
    Collection.prototype.ensureAllIndexes = function (force) {
      var key, bIndices = this.binaryIndices;
      for (key in bIndices) {
        if (hasOwnProperty.call(bIndices, key)) {
          this.ensureIndex(key, force);
        }
      }
    };

    /**
     * Internal method used to flag all lazy index as dirty
     */
    Collection.prototype.flagBinaryIndexesDirty = function () {
      var key, bIndices = this.binaryIndices;
      for (key in bIndices) {
        if (hasOwnProperty.call(bIndices, key)) {
          bIndices[key].dirty = true;
        }
      }
    };

    /**
     * Internal method used to flag a lazy index as dirty
     */
    Collection.prototype.flagBinaryIndexDirty = function (index) {
      if (this.binaryIndices[index])
        this.binaryIndices[index].dirty = true;
    };

    /**
     * Quickly determine number of documents in collection (or query)
     * @param {object=} query - (optional) query object to count results of
     * @returns {number} number of documents in the collection
     * @memberof Collection
     */
    Collection.prototype.count = function (query) {
      if (!query) {
        return this.data.length;
      }

      return this.chain().find(query).filteredrows.length;
    };

    /**
     * Rebuild idIndex
     */
    Collection.prototype.ensureId = function () {
      if (this.idIndex) {
        return;
      }
      var data = this.data,
        i = 0;
      var len = data.length;
      var index = new Array(len);
      for (i; i < len; i++) {
        index[i] = data[i].$loki;
      }
      this.idIndex = index;
    };
    
// (Code skipped for WatermelonDB build)

    /**
     * Applies a 'mongo-like' find query object and passes all results to an update function.
     * For filter function querying you should migrate to [updateWhere()]{@link Collection#updateWhere}.
     *
     * @param {object|function} filterObject - 'mongo-like' query object (or deprecated filterFunction mode)
     * @param {function} updateFunction - update function to run against filtered documents
     * @memberof Collection
     */
    Collection.prototype.findAndUpdate = function (filterObject, updateFunction) {
      if (typeof (filterObject) === "function") {
        this.updateWhere(filterObject, updateFunction);
      }
      else {
        this.chain().find(filterObject).update(updateFunction);
      }
    };

    /**
     * Applies a 'mongo-like' find query object removes all documents which match that filter.
     *
     * @param {object} filterObject - 'mongo-like' query object
     * @memberof Collection
     */
    Collection.prototype.findAndRemove = function (filterObject) {
      this.chain().find(filterObject).remove();
    };

    /**
     * Adds object(s) to collection, ensure object(s) have meta properties, clone it if necessary, etc.
     * @param {(object|array)} doc - the document (or array of documents) to be inserted
     * @param {boolean=} overrideAdaptiveIndices - (optional) if `true`, adaptive indicies will be
     *   temporarily disabled and then fully rebuilt after batch. This will be faster for
     *   large inserts, but slower for small/medium inserts in large collections
     * @returns {(object|array)} document or documents inserted
     * @memberof Collection
     * @example
     * users.insert({
     *     name: 'Odin',
     *     age: 50,
     *     address: 'Asgard'
     * });
     *
     * // alternatively, insert array of documents
     * users.insert([{ name: 'Thor', age: 35}, { name: 'Loki', age: 30}]);
     */
    Collection.prototype.insert = function (doc, overrideAdaptiveIndices) {
      if (!Array.isArray(doc)) {
        return this.insertOne(doc);
      }

      // holder to the clone of the object inserted if collections is set to clone objects
      var obj;
      var results = [];

      // if not cloning, disable adaptive binary indices for the duration of the batch insert,
      // followed by lazy rebuild and re-enabling adaptive indices after batch insert.
      var adaptiveBatchOverride = overrideAdaptiveIndices && !this.cloneObjects &&
        this.adaptiveBinaryIndices && Object.keys(this.binaryIndices).length > 0;

      if (adaptiveBatchOverride) {
        this.adaptiveBinaryIndices = false;
      }

      try {
        this.emit('pre-insert', doc);
        for (var i = 0, len = doc.length; i < len; i++) {
          obj = this.insertOne(doc[i], true);
          if (!obj) {
            return undefined;
          }
          results.push(obj);
        }
      } finally {
        if (adaptiveBatchOverride) {
          this.ensureAllIndexes();
          this.adaptiveBinaryIndices = true;
        }
      }

      // at the 'batch' level, if clone option is true then emitted docs are clones
      this.emit('insert', results);

      // if clone option is set, clone return values
      results = this.cloneObjects ? clone(results, this.cloneMethod) : results;

      return results.length === 1 ? results[0] : results;
    };

    /**
     * Adds a single object, ensures it has meta properties, clone it if necessary, etc.
     * @param {object} doc - the document to be inserted
     * @param {boolean} bulkInsert - quiet pre-insert and insert event emits
     * @returns {object} document or 'undefined' if there was a problem inserting it
     */
    Collection.prototype.insertOne = function (doc, bulkInsert) {
      var err = null;
      var returnObj;

      if (typeof doc !== 'object') {
        err = new TypeError('Document needs to be an object');
      } else if (doc === null) {
        err = new TypeError('Object cannot be null');
      }

      if (err !== null) {
        this.emit('error', err);
        throw err;
      }

      // if configured to clone, do so now... otherwise just use same obj reference
      var obj = this.cloneObjects ? clone(doc, this.cloneMethod) : doc;
      if (!this.disableFreeze) {
        obj = unFreeze(obj);
      }

      if (!this.disableMeta) {
        if (typeof obj.meta === 'undefined') {
          obj.meta = {
            revision: 0,
            created: 0
          };
        } else if (!this.disableFreeze) {
          obj.meta = unFreeze(obj.meta);
        }
      }

      // both 'pre-insert' and 'insert' events are passed internal data reference even when cloning
      // insert needs internal reference because that is where loki itself listens to add meta
      if (!bulkInsert) {
        this.emit('pre-insert', obj);
      }
      if (!this.add(obj)) {
        return undefined;
      }

      // update meta and store changes if ChangesAPI is enabled
      // (moved from "insert" event listener to allow internal reference to be used)
      
// (Code skipped for WatermelonDB build)


      if (!this.disableFreeze) {
        deepFreeze(obj);
      }

      // if cloning is enabled, emit insert event with clone of new object
      returnObj = this.cloneObjects ? clone(obj, this.cloneMethod) : obj;

      if (!bulkInsert) {
        this.emit('insert', returnObj);
      }

      this.addAutoUpdateObserver(returnObj);

      return returnObj;
    };

    /**
     * Empties the collection.
     * @param {object=} options - configure clear behavior
     * @param {bool=} [options.removeIndices=false] - whether to remove indices in addition to data
     * @memberof Collection
     */
    Collection.prototype.clear = function (options) {
      var self = this;

      options = options || {};

      this.data = [];
      this.idIndex = null;
      this.cachedIndex = null;
      this.cachedBinaryIndex = null;
      this.cachedData = null;
      this.maxId = 0;
      this.DynamicViews = [];
      this.dirty = true;
      this.constraints = {
        unique: {},
        exact: {}
      };

      // if removing indices entirely
      if (options.removeIndices === true) {
        this.binaryIndices = {};
        this.uniqueNames = [];
      }
      // clear indices but leave definitions in place
      else {
        // clear binary indices
        var keys = Object.keys(this.binaryIndices);
        keys.forEach(function (biname) {
          self.binaryIndices[biname].dirty = false;
          self.binaryIndices[biname].values = [];
        });
      }
    };

    /**
     * Updates an object and notifies collection that the document has changed.
     * @param {object} doc - document to update within the collection
     * @memberof Collection
     */
    Collection.prototype.update = function (doc) {
      var adaptiveBatchOverride, k, len;

      if (Array.isArray(doc)) {
        len = doc.length;

        // if not cloning, disable adaptive binary indices for the duration of the batch update,
        // followed by lazy rebuild and re-enabling adaptive indices after batch update.
        adaptiveBatchOverride = !this.cloneObjects &&
          this.adaptiveBinaryIndices && Object.keys(this.binaryIndices).length > 0;

        if (adaptiveBatchOverride) {
          this.adaptiveBinaryIndices = false;
        }

        try {
          for (k = 0; k < len; k += 1) {
            this.update(doc[k]);
          }
        }
        finally {
          if (adaptiveBatchOverride) {
            this.ensureAllIndexes();
            this.adaptiveBinaryIndices = true;
          }
        }

        return;
      }

      // verify object is a properly formed document
      if (!hasOwnProperty.call(doc, '$loki')) {
        throw new Error('Trying to update unsynced document. Please save the document first by using insert() or addMany()');
      }
      try {
        this.startTransaction();
        var arr = this.get(doc.$loki, true),
          oldInternal,   // ref to existing obj
          newInternal, // ref to new internal obj
          position,
          self = this;

        if (!arr) {
          throw new Error('Trying to update a document not in collection.');
        }

        oldInternal = arr[0]; // -internal- obj ref
        position = arr[1]; // position in data array

        // if configured to clone, do so now... otherwise just use same obj reference
        newInternal = this.cloneObjects || (!this.disableDeltaChangesApi && this.disableFreeze) ? clone(doc, this.cloneMethod) : doc;

        this.emit('pre-update', doc);

        this.uniqueNames.forEach(function (key) {
          self.getUniqueIndex(key, true).update(oldInternal, newInternal);
        });

        // operate the update
        this.data[position] = newInternal;

        if (newInternal !== doc) {
          this.addAutoUpdateObserver(doc);
        }

        // now that we can efficiently determine the data[] position of newly added document,
        // submit it for all registered DynamicViews to evaluate for inclusion/exclusion
        for (var idx = 0; idx < this.DynamicViews.length; idx++) {
          this.DynamicViews[idx].evaluateDocument(position, false);
        }

        var key;
        if (this.adaptiveBinaryIndices) {
          // for each binary index defined in collection, immediately update rather than flag for lazy rebuild
          var bIndices = this.binaryIndices;
          for (key in bIndices) {
            this.adaptiveBinaryIndexUpdate(position, key);
          }
        }
        else {
          this.flagBinaryIndexesDirty();
        }

        this.idIndex[position] = newInternal.$loki;
        //this.flagBinaryIndexesDirty();

        if (this.isIncremental) {
          this.dirtyIds.push(newInternal.$loki);
        }

        this.commit();
        this.dirty = true; // for autosave scenarios

        // update meta and store changes if ChangesAPI is enabled
        
// (Code skipped for WatermelonDB build)


        if (!this.disableFreeze) {
          deepFreeze(newInternal);
        }

        var returnObj;

        // if cloning is enabled, emit 'update' event and return with clone of new object
        if (this.cloneObjects) {
          returnObj = clone(newInternal, this.cloneMethod);
        }
        else {
          returnObj = newInternal;
        }

        this.emit('update', returnObj, oldInternal);
        return returnObj;
      } catch (err) {
        this.rollback();
        this.lokiConsoleWrapper.error(err.message);
        this.emit('error', err);
        throw (err); // re-throw error so user does not think it succeeded
      }
    };

    /**
     * Add object to collection
     */
    Collection.prototype.add = function (obj) {
      // if parameter isn't object exit with throw
      if ('object' !== typeof obj) {
        throw new TypeError('Object being added needs to be an object');
      }
      // if object you are adding already has id column it is either already in the collection
      // or the object is carrying its own 'id' property.  If it also has a meta property,
      // then this is already in collection so throw error, otherwise rename to originalId and continue adding.
      if (typeof (obj.$loki) !== 'undefined') {
        throw new Error('Document is already in collection, please use update()');
      }

      /*
       * try adding object to collection
       */
      try {
        this.startTransaction();
        this.maxId++;

        if (isNaN(this.maxId)) {
          this.maxId = (this.data[this.data.length - 1].$loki + 1);
        }

        var newId = this.maxId;
        obj.$loki = newId;

        if (!this.disableMeta) {
          obj.meta.version = 0;
        }

        for (var i = 0, len = this.uniqueNames.length; i < len; i ++) {
          this.getUniqueIndex(this.uniqueNames[i], true).set(obj);
        }

        if (this.idIndex) {
          this.idIndex.push(newId);
        }

        if (this.isIncremental) {
          this.dirtyIds.push(newId);
        }

        // add the object
        this.data.push(obj);

        var addedPos = this.data.length - 1;

        // now that we can efficiently determine the data[] position of newly added document,
        // submit it for all registered DynamicViews to evaluate for inclusion/exclusion
        var dvlen = this.DynamicViews.length;
        for (i = 0; i < dvlen; i++) {
          this.DynamicViews[i].evaluateDocument(addedPos, true);
        }

        if (this.adaptiveBinaryIndices) {
          // for each binary index defined in collection, immediately update rather than flag for lazy rebuild
          var bIndices = this.binaryIndices;
          for (var key in bIndices) {
            this.adaptiveBinaryIndexInsert(addedPos, key);
          }
        }
        else {
          this.flagBinaryIndexesDirty();
        }

        this.commit();
        this.dirty = true; // for autosave scenarios

        return (this.cloneObjects) ? (clone(obj, this.cloneMethod)) : (obj);
      } catch (err) {
        this.rollback();
        this.lokiConsoleWrapper.error(err.message);
        this.emit('error', err);
        throw (err); // re-throw error so user does not think it succeeded
      }
    };

    /**
     * Applies a filter function and passes all results to an update function.
     *
     * @param {function} filterFunction - filter function whose results will execute update
     * @param {function} updateFunction - update function to run against filtered documents
     * @memberof Collection
     */
    Collection.prototype.updateWhere = function (filterFunction, updateFunction) {
      var results = this.where(filterFunction),
        i = 0,
        obj;
      try {
        for (i; i < results.length; i++) {
          obj = updateFunction(results[i]);
          this.update(obj);
        }

      } catch (err) {
        this.rollback();
        this.lokiConsoleWrapper.error(err.message);
      }
    };

    /**
     * Remove all documents matching supplied filter function.
     * For 'mongo-like' querying you should migrate to [findAndRemove()]{@link Collection#findAndRemove}.
     * @param {function|object} query - query object to filter on
     * @memberof Collection
     */
    Collection.prototype.removeWhere = function (query) {
      var list;
      if (typeof query === 'function') {
        list = this.data.filter(query);
        this.remove(list);
      } else {
        this.chain().find(query).remove();
      }
    };

    Collection.prototype.removeDataOnly = function () {
      this.remove(this.data.slice());
    };

    /**
     * Internal method to remove a batch of documents from the collection.
     * @param {number[]} positions - data/idIndex positions to remove
     */
    Collection.prototype.removeBatchByPositions = function (positions) {
      var len = positions.length;
      var xo = {};
      var dlen, didx, idx;
      var bic = Object.keys(this.binaryIndices).length;
      var uic = Object.keys(this.constraints.unique).length;
      var adaptiveOverride = this.adaptiveBinaryIndices && Object.keys(this.binaryIndices).length > 0;
      var doc, self = this;

      try {
        this.startTransaction();

        // create hashobject for positional removal inclusion tests...
        // all keys defined in this hashobject represent $loki ids of the documents to remove.
        this.ensureId();
        for (idx = 0; idx < len; idx++) {
          xo[this.idIndex[positions[idx]]] = true;
        }

        // if we will need to notify dynamic views and/or binary indices to update themselves...
        dlen = this.DynamicViews.length;
        if ((dlen > 0) || (bic > 0) || (uic > 0)) {
          if (dlen > 0) {
            // notify dynamic views to remove relevant documents at data positions
            for (didx = 0; didx < dlen; didx++) {
              // notify dv of remove (passing batch/array of positions)
              this.DynamicViews[didx].removeDocument(positions);
            }
          }

          // notify binary indices to update
          if (this.adaptiveBinaryIndices && !adaptiveOverride) {
            // for each binary index defined in collection, immediately update rather than flag for lazy rebuild
            var key, bIndices = this.binaryIndices;

            for (key in bIndices) {
              this.adaptiveBinaryIndexRemove(positions, key);
            }
          }
          else {
            this.flagBinaryIndexesDirty();
          }

          if (uic) {
            this.uniqueNames.forEach(function (key) {
              var index = self.getUniqueIndex(key);
              if (index) {
                for (idx = 0; idx < len; idx++) {
                  doc = self.data[positions[idx]];
                  if (doc[key] !== null && doc[key] !== undefined) {
                    index.remove(doc[key]);
                  }
                }
              }
            });
          }
        }

        // emit 'delete' events only of listeners are attached.
        // since data not removed yet, in future we can emit single delete event with array...
        // for now that might be breaking change to put in potential 1.6 or LokiDB (lokijs2) version
        if (!this.disableChangesApi || this.events.delete.length > 1) {
          for (idx = 0; idx < len; idx++) {
            this.emit('delete', this.data[positions[idx]]);
          }
        }

        // remove from data[] :
        // filter collection data for items not in inclusion hashobject
        this.data = this.data.filter(function (obj) {
          return !xo[obj.$loki];
        });

        if (this.isIncremental) {
          for(idx=0; idx < len; idx++) {
            this.dirtyIds.push(this.idIndex[positions[idx]]);
          }
        }

        // remove from idIndex[] :
        // filter idIndex for items not in inclusion hashobject
        this.idIndex = this.idIndex.filter(function (id) {
          return !xo[id];
        });

        if (this.adaptiveBinaryIndices && adaptiveOverride) {
          this.adaptiveBinaryIndices = false;
          this.ensureAllIndexes(true);
          this.adaptiveBinaryIndices = true;
        }

        this.commit();

        // flag collection as dirty for autosave
        this.dirty = true;
      }
      catch (err) {
        this.rollback();
        if (adaptiveOverride) {
          this.adaptiveBinaryIndices = true;
        }
        this.lokiConsoleWrapper.error(err.message);
        this.emit('error', err);
        return null;
      }
    };

    /**
     *  Internal method called by remove()
     * @param {object[]|number[]} batch - array of documents or $loki ids to remove
     */
    Collection.prototype.removeBatch = function (batch) {
      var len = batch.length,
        dlen = this.data.length,
        idx;
      var xlt = {};
      var posx = [];

      // create lookup hashobject to translate $loki id to position
      for (idx = 0; idx < dlen; idx++) {
        xlt[this.data[idx].$loki] = idx;
      }

      // iterate the batch
      for (idx = 0; idx < len; idx++) {
        if (typeof (batch[idx]) === 'object') {
          posx.push(xlt[batch[idx].$loki]);
        }
        else {
          posx.push(xlt[batch[idx]]);
        }
      }

      this.removeBatchByPositions(posx);
    };

    /**
     * Remove a document from the collection
     * @param {object} doc - document to remove from collection
     * @memberof Collection
     */
    Collection.prototype.remove = function (doc) {
      var frozen;

      if (typeof doc === 'number') {
        doc = this.get(doc);
      }

      if ('object' !== typeof doc) {
        throw new Error('Parameter is not an object');
      }
      if (Array.isArray(doc)) {
        this.removeBatch(doc);
        return;
      }

      if (!hasOwnProperty.call(doc, '$loki')) {
        throw new Error('Object is not a document stored in the collection');
      }

      try {
        this.startTransaction();
        var arr = this.get(doc.$loki, true),
          // obj = arr[0],
          position = arr[1];
        var self = this;
        this.uniqueNames.forEach(function (key) {
          if (doc[key] !== null && typeof doc[key] !== 'undefined') {
            var index = self.getUniqueIndex(key);
            if (index) {
              index.remove(doc[key]);
            }
          }
        });
        // now that we can efficiently determine the data[] position of newly added document,
        // submit it for all registered DynamicViews to remove
        for (var idx = 0; idx < this.DynamicViews.length; idx++) {
          this.DynamicViews[idx].removeDocument(position);
        }

        if (this.adaptiveBinaryIndices) {
          // for each binary index defined in collection, immediately update rather than flag for lazy rebuild
          var key, bIndices = this.binaryIndices;
          for (key in bIndices) {
            this.adaptiveBinaryIndexRemove(position, key);
          }
        }
        else {
          this.flagBinaryIndexesDirty();
        }

        this.data.splice(position, 1);
        this.removeAutoUpdateObserver(doc);

        // remove id from idIndex
        this.idIndex.splice(position, 1);

        if (this.isIncremental) {
          this.dirtyIds.push(doc.$loki);
        }

        this.commit();
        this.dirty = true; // for autosave scenarios
        this.emit('delete', arr[0]);

        if (!this.disableFreeze) {
          doc = unFreeze(doc);
        }
        delete doc.$loki;
        delete doc.meta;
        if (!this.disableFreeze) {
          freeze(doc);
        }
        return doc;

      } catch (err) {
        this.rollback();
        this.lokiConsoleWrapper.error(err.message);
        this.emit('error', err);
        return null;
      }
    };

    /*---------------------+
    | Finding methods     |
    +----------------------*/

    /**
     * Get by Id - faster than other methods because of the searching algorithm
     * @param {int} id - $loki id of document you want to retrieve
     * @param {boolean} returnPosition - if 'true' we will return [object, position]
     * @returns {(object|array|null)} Object reference if document was found, null if not,
     *     or an array if 'returnPosition' was passed.
     * @memberof Collection
     */
    Collection.prototype.get = function (id, returnPosition) {
      if (!this.idIndex) {
        this.ensureId();
      }

      var retpos = returnPosition || false,
        data = this.idIndex,
        max = data.length - 1,
        min = 0,
        mid = (min + max) >> 1;

      id = typeof id === 'number' ? id : parseInt(id, 10);

      if (isNaN(id)) {
        throw new TypeError('Passed id is not an integer');
      }

      while (data[min] < data[max]) {
        mid = (min + max) >> 1;

        if (data[mid] < id) {
          min = mid + 1;
        } else {
          max = mid;
        }
      }

      if (max === min && data[min] === id) {
        if (retpos) {
          return [this.data[min], min];
        }
        return this.data[min];
      }
      return null;

    };

    /**
     * Perform binary range lookup for the data[dataPosition][binaryIndexName] property value
     *    Since multiple documents may contain the same value (which the index is sorted on),
     *    we hone in on range and then linear scan range to find exact index array position.
     * @param {int} dataPosition : coll.data array index/position
     * @param {string} binaryIndexName : index to search for dataPosition in
     */
    Collection.prototype.getBinaryIndexPosition = function (dataPosition, binaryIndexName) {
      var val = Utils.getIn(this.data[dataPosition], binaryIndexName, true);
      var index = this.binaryIndices[binaryIndexName].values;

      // i think calculateRange can probably be moved to collection
      // as it doesn't seem to need resultset.  need to verify
      var range = this.calculateRange("$eq", binaryIndexName, val);

      if (range[0] === 0 && range[1] === -1) {
        // uhoh didn't find range
        return null;
      }

      var min = range[0];
      var max = range[1];

      // narrow down the sub-segment of index values
      // where the indexed property value exactly matches our
      // value and then linear scan to find exact -index- position
      for (var idx = min; idx <= max; idx++) {
        if (index[idx] === dataPosition) return idx;
      }

      // uhoh
      return null;
    };

    /**
     * Adaptively insert a selected item to the index.
     * @param {int} dataPosition : coll.data array index/position
     * @param {string} binaryIndexName : index to search for dataPosition in
     */
    Collection.prototype.adaptiveBinaryIndexInsert = function (dataPosition, binaryIndexName) {
      var usingDotNotation = (binaryIndexName.indexOf('.') !== -1);
      var index = this.binaryIndices[binaryIndexName].values;
      var val = Utils.getIn(this.data[dataPosition], binaryIndexName, usingDotNotation);

      // If you are inserting a javascript Date value into a binary index, convert to epoch time
      if (this.serializableIndices === true && val instanceof Date) {
        this.data[dataPosition][binaryIndexName] = val.getTime();
        val = Utils.getIn(this.data[dataPosition], binaryIndexName);
      }

      var idxPos = (index.length === 0) ? 0 : this.calculateRangeStart(binaryIndexName, val, true, usingDotNotation);

      // insert new data index into our binary index at the proper sorted location for relevant property calculated by idxPos.
      // doing this after adjusting dataPositions so no clash with previous item at that position.
      this.binaryIndices[binaryIndexName].values.splice(idxPos, 0, dataPosition);
    };

    /**
     * Adaptively update a selected item within an index.
     * @param {int} dataPosition : coll.data array index/position
     * @param {string} binaryIndexName : index to search for dataPosition in
     */
    Collection.prototype.adaptiveBinaryIndexUpdate = function (dataPosition, binaryIndexName) {
      // linear scan needed to find old position within index unless we optimize for clone scenarios later
      // within (my) node 5.6.0, the following for() loop with strict compare is -much- faster than indexOf()
      var idxPos,
        index = this.binaryIndices[binaryIndexName].values,
        len = index.length;

      for (idxPos = 0; idxPos < len; idxPos++) {
        if (index[idxPos] === dataPosition) break;
      }

      //var idxPos = this.binaryIndices[binaryIndexName].values.indexOf(dataPosition);
      this.binaryIndices[binaryIndexName].values.splice(idxPos, 1);

      //this.adaptiveBinaryIndexRemove(dataPosition, binaryIndexName, true);
      this.adaptiveBinaryIndexInsert(dataPosition, binaryIndexName);
    };

    /**
     * Adaptively remove a selected item from the index.
     * @param {number|number[]} dataPosition : coll.data array index/position
     * @param {string} binaryIndexName : index to search for dataPosition in
     */
    Collection.prototype.adaptiveBinaryIndexRemove = function (dataPosition, binaryIndexName, removedFromIndexOnly) {
      var bi = this.binaryIndices[binaryIndexName];
      var len, idx, rmidx, rmlen, rxo = {};
      var curr, shift, idxPos;

      if (Array.isArray(dataPosition)) {
        // when called from chained remove, and only one document in array,
        // it will be faster to use old algorithm
        rmlen = dataPosition.length;
        if (rmlen === 1) {
          dataPosition = dataPosition[0];
        }
        // we were passed an array (batch) of documents so use this 'batch optimized' algorithm
        else {
          for (rmidx = 0; rmidx < rmlen; rmidx++) {
            rxo[dataPosition[rmidx]] = true;
          }

          // remove document from index (with filter function)
          bi.values = bi.values.filter(function (di) { return !rxo[di]; });

          // if we passed this optional flag parameter, we are calling from adaptiveBinaryIndexUpdate,
          // in which case data positions stay the same.
          if (removedFromIndexOnly === true) {
            return;
          }

          var sortedPositions = dataPosition.slice();
          sortedPositions.sort(function (a, b) { return a - b; });

          // to remove holes, we need to 'shift down' the index's data array positions
          // we need to adjust array positions -1 for each index data positions greater than removed positions
          len = bi.values.length;
          for (idx = 0; idx < len; idx++) {
            curr = bi.values[idx];
            shift = 0;
            for (rmidx = 0; rmidx < rmlen && curr > sortedPositions[rmidx]; rmidx++) {
              shift++;
            }
            bi.values[idx] -= shift;
          }

          // batch processed, bail out
          return;
        }

        // not a batch so continue...
      }

      idxPos = this.getBinaryIndexPosition(dataPosition, binaryIndexName);

      if (idxPos === null) {
        // throw new Error('unable to determine binary index position');
        return null;
      }

      // remove document from index (with splice)
      bi.values.splice(idxPos, 1);

      // if we passed this optional flag parameter, we are calling from adaptiveBinaryIndexUpdate,
      // in which case data positions stay the same.
      if (removedFromIndexOnly === true) {
        return;
      }

      // since index stores data array positions, if we remove a document
      // we need to adjust array positions -1 for all document positions greater than removed position
      len = bi.values.length;
      for (idx = 0; idx < len; idx++) {
        if (bi.values[idx] > dataPosition) {
          bi.values[idx]--;
        }
      }
    };

    /**
     * Internal method used for index maintenance and indexed searching.
     * Calculates the beginning of an index range for a given value.
     * For index maintainance (adaptive:true), we will return a valid index position to insert to.
     * For querying (adaptive:false/undefined), we will :
     *    return lower bound/index of range of that value (if found)
     *    return next lower index position if not found (hole)
     * If index is empty it is assumed to be handled at higher level, so
     * this method assumes there is at least 1 document in index.
     *
     * @param {string} prop - name of property which has binary index
     * @param {any} val - value to find within index
     * @param {bool?} adaptive - if true, we will return insert position
     */
    Collection.prototype.calculateRangeStart = function (prop, val, adaptive, usingDotNotation) {
      var rcd = this.data;
      var index = this.binaryIndices[prop].values;
      var min = 0;
      var max = index.length - 1;
      var mid = 0;

      if (index.length === 0) {
        return -1;
      }

      var minVal = Utils.getIn(rcd[index[min]], prop, usingDotNotation);
      var maxVal = Utils.getIn(rcd[index[max]], prop, usingDotNotation);

      // hone in on start position of value
      while (min < max) {
        mid = (min + max) >> 1;

        if (Comparators.lt(Utils.getIn(rcd[index[mid]], prop, usingDotNotation), val, false)) {
          min = mid + 1;
        } else {
          max = mid;
        }
      }

      var lbound = min;

      // found it... return it
      if (Comparators.aeq(val, Utils.getIn(rcd[index[lbound]], prop, usingDotNotation))) {
        return lbound;
      }

      // if not in index and our value is less than the found one
      if (Comparators.lt(val, Utils.getIn(rcd[index[lbound]], prop, usingDotNotation), false)) {
        return adaptive ? lbound : lbound - 1;
      }

      // not in index and our value is greater than the found one
      return adaptive ? lbound + 1 : lbound;
    };

    /**
     * Internal method used for indexed $between.  Given a prop (index name), and a value
     * (which may or may not yet exist) this will find the final position of that upper range value.
     */
    Collection.prototype.calculateRangeEnd = function (prop, val, usingDotNotation) {
      var rcd = this.data;
      var index = this.binaryIndices[prop].values;
      var min = 0;
      var max = index.length - 1;
      var mid = 0;

      if (index.length === 0) {
        return -1;
      }

      var minVal = Utils.getIn(rcd[index[min]], prop, usingDotNotation);
      var maxVal = Utils.getIn(rcd[index[max]], prop, usingDotNotation);

      // hone in on start position of value
      while (min < max) {
        mid = (min + max) >> 1;

        if (Comparators.lt(val, Utils.getIn(rcd[index[mid]], prop, usingDotNotation), false)) {
          max = mid;
        } else {
          min = mid + 1;
        }
      }

      var ubound = max;

      // only eq if last element in array is our val
      if (Comparators.aeq(val, Utils.getIn(rcd[index[ubound]], prop, usingDotNotation))) {
        return ubound;
      }

      // if not in index and our value is less than the found one
      if (Comparators.gt(val, Utils.getIn(rcd[index[ubound]], prop, usingDotNotation), false)) {
        return ubound + 1;
      }

      // either hole or first nonmatch
      if (Comparators.aeq(val, Utils.getIn(rcd[index[ubound - 1]], prop, usingDotNotation))) {
        return ubound - 1;
      }

      // hole, so ubound if nearest gt than the val we were looking for
      return ubound;
    };

    /**
     * calculateRange() - Binary Search utility method to find range/segment of values matching criteria.
     *    this is used for collection.find() and first find filter of resultset/dynview
     *    slightly different than get() binary search in that get() hones in on 1 value,
     *    but we have to hone in on many (range)
     * @param {string} op - operation, such as $eq
     * @param {string} prop - name of property to calculate range for
     * @param {object} val - value to use for range calculation.
     * @returns {array} [start, end] index array positions
     */
    Collection.prototype.calculateRange = function (op, prop, val) {
      var rcd = this.data;
      var index = this.binaryIndices[prop].values;
      var min = 0;
      var max = index.length - 1;
      var mid = 0;
      var lbound, lval;
      var ubound, uval;

      // when no documents are in collection, return empty range condition
      if (rcd.length === 0) {
        return [0, -1];
      }

      var usingDotNotation = (prop.indexOf('.') !== -1);

      var minVal = Utils.getIn(rcd[index[min]], prop, usingDotNotation);
      var maxVal = Utils.getIn(rcd[index[max]], prop, usingDotNotation);

      // if value falls outside of our range return [0, -1] to designate no results
      switch (op) {
        case '$eq':
        case '$aeq':
          if (Comparators.lt(val, minVal, false) || Comparators.gt(val, maxVal, false)) {
            return [0, -1];
          }
          break;
        case '$dteq':
          if (Comparators.lt(val, minVal, false) || Comparators.gt(val, maxVal, false)) {
            return [0, -1];
          }
          break;
        case '$gt':
          // none are within range
          if (Comparators.gt(val, maxVal, true)) {
            return [0, -1];
          }
          // all are within range
          if (Comparators.gt(minVal, val, false)) {
            return [min, max];
          }
          break;
        case '$gte':
          // none are within range
          if (Comparators.gt(val, maxVal, false)) {
            return [0, -1];
          }
          // all are within range
          if (Comparators.gt(minVal, val, true)) {
            return [min, max];
          }
          break;
        case '$lt':
          // none are within range
          if (Comparators.lt(val, minVal, true)) {
            return [0, -1];
          }
          // all are within range
          if (Comparators.lt(maxVal, val, false)) {
            return [min, max];
          }
          break;
        case '$lte':
          // none are within range
          if (Comparators.lt(val, minVal, false)) {
            return [0, -1];
          }
          // all are within range
          if (Comparators.lt(maxVal, val, true)) {
            return [min, max];
          }
          break;
        case '$between':
          // none are within range (low range is greater)
          if (Comparators.gt(val[0], maxVal, false)) {
            return [0, -1];
          }
          // none are within range (high range lower)
          if (Comparators.lt(val[1], minVal, false)) {
            return [0, -1];
          }

          lbound = this.calculateRangeStart(prop, val[0], false, usingDotNotation);
          ubound = this.calculateRangeEnd(prop, val[1], usingDotNotation);

          if (lbound < 0) lbound++;
          if (ubound > max) ubound--;

          if (!Comparators.gt(Utils.getIn(rcd[index[lbound]], prop, usingDotNotation), val[0], true)) lbound++;
          if (!Comparators.lt(Utils.getIn(rcd[index[ubound]], prop, usingDotNotation), val[1], true)) ubound--;

          if (ubound < lbound) return [0, -1];

          return ([lbound, ubound]);
        case '$in':
          var idxset = [],
            segResult = [];
          // query each value '$eq' operator and merge the seqment results.
          for (var j = 0, len = val.length; j < len; j++) {
            var seg = this.calculateRange('$eq', prop, val[j]);

            for (var i = seg[0]; i <= seg[1]; i++) {
              if (idxset[i] === undefined) {
                idxset[i] = true;
                segResult.push(i);
              }
            }
          }
          return segResult;
      }

      // determine lbound where needed
      switch (op) {
        case '$eq':
        case '$aeq':
        case '$dteq':
        case '$gte':
        case '$lt':
          lbound = this.calculateRangeStart(prop, val, false, usingDotNotation);
          lval = Utils.getIn(rcd[index[lbound]], prop, usingDotNotation);
          break;
        default: break;
      }

      // determine ubound where needed
      switch (op) {
        case '$eq':
        case '$aeq':
        case '$dteq':
        case '$lte':
        case '$gt':
          ubound = this.calculateRangeEnd(prop, val, usingDotNotation);
          uval = Utils.getIn(rcd[index[ubound]], prop, usingDotNotation);
          break;
        default: break;
      }


      switch (op) {
        case '$eq':
        case '$aeq':
        case '$dteq':
          // if hole (not found)
          if (!Comparators.aeq(lval, val)) {
            return [0, -1];
          }

          return [lbound, ubound];

        case '$gt':
          // if hole (not found) ub position is already greater
          if (!Comparators.aeq(Utils.getIn(rcd[index[ubound]], prop, usingDotNotation), val)) {
            return [ubound, max];
          }
          // otherwise (found) so ubound is still equal, get next
          return [ubound + 1, max];

        case '$gte':
          // if hole (not found) lb position marks left outside of range
          if (!Comparators.aeq(Utils.getIn(rcd[index[lbound]], prop, usingDotNotation), val)) {
            return [lbound + 1, max];
          }
          // otherwise (found) so lb is first position where its equal
          return [lbound, max];

        case '$lt':
          // if hole (not found) position already is less than
          if (!Comparators.aeq(Utils.getIn(rcd[index[lbound]], prop, usingDotNotation), val)) {
            return [min, lbound];
          }
          // otherwise (found) so lb marks left inside of eq range, get previous
          return [min, lbound - 1];

        case '$lte':
          // if hole (not found) ub position marks right outside so get previous
          if (!Comparators.aeq(Utils.getIn(rcd[index[ubound]], prop, usingDotNotation), val)) {
            return [min, ubound - 1];
          }
          // otherwise (found) so ub is last position where its still equal
          return [min, ubound];

        default:
          return [0, rcd.length - 1];
      }
    };

    /**
     * Retrieve doc by Unique index
     * @param {string} field - name of uniquely indexed property to use when doing lookup
     * @param {value} value - unique value to search for
     * @returns {object} document matching the value passed
     * @memberof Collection
     */
    Collection.prototype.by = function (field, value) {
      var self;
      if (value === undefined) {
        self = this;
        return function (value) {
          return self.by(field, value);
        };
      }

      var result = this.getUniqueIndex(field, true).get(value);
      if (!this.cloneObjects) {
        return result;
      } else {
        return clone(result, this.cloneMethod);
      }
    };

    /**
     * Find one object by index property, by property equal to value
     * @param {object} query - query object used to perform search with
     * @returns {(object|null)} First matching document, or null if none
     * @memberof Collection
     */
    Collection.prototype.findOne = function (query) {
      query = query || {};

      // Instantiate Resultset and exec find op passing firstOnly = true param
      var result = this.chain().find(query, true).data();

      if (Array.isArray(result) && result.length === 0) {
        return null;
      } else {
        if (!this.cloneObjects) {
          return result[0];
        } else {
          return clone(result[0], this.cloneMethod);
        }
      }
    };

    /**
     * Chain method, used for beginning a series of chained find() and/or view() operations
     * on a collection.
     *
     * @param {string|array=} transform - named transform or array of transform steps
     * @param {object=} parameters - Object containing properties representing parameters to substitute
     * @returns {Resultset} (this) resultset, or data array if any map or join functions where called
     * @memberof Collection
     */
    Collection.prototype.chain = function (transform, parameters) {
      var rs = new Resultset(this);

      if (typeof transform === 'undefined') {
        return rs;
      }

      return rs.transform(transform, parameters);
    };

    /**
     * Find method, api is similar to mongodb.
     * for more complex queries use [chain()]{@link Collection#chain} or [where()]{@link Collection#where}.
     * @example {@tutorial Query Examples}
     * @param {object} query - 'mongo-like' query object
     * @returns {array} Array of matching documents
     * @memberof Collection
     */
    Collection.prototype.find = function (query) {
      return this.chain().find(query).data();
    };

    /**
     * Find object by unindexed field by property equal to value,
     * simply iterates and returns the first element matching the query
     */
    Collection.prototype.findOneUnindexed = function (prop, value) {
      var i = this.data.length,
        doc;
      while (i--) {
        if (Utils.getIn(this.data[i], prop, true) === value) {
          doc = this.data[i];
          return doc;
        }
      }
      return null;
    };

    /**
     * Transaction methods
     */

    /** start the transation */
    Collection.prototype.startTransaction = function () {
      
// (Code skipped for WatermelonDB build)

    };

    /** commit the transation */
    Collection.prototype.commit = function () {
      
// (Code skipped for WatermelonDB build)

    };

    /** roll back the transation */
    Collection.prototype.rollback = function () {
      
// (Code skipped for WatermelonDB build)

    };

    
// (Code skipped for WatermelonDB build)

    /**
     * Query the collection by supplying a javascript filter function.
     * @example
     * var results = coll.where(function(obj) {
     *   return obj.legs === 8;
     * });
     *
     * @param {function} fun - filter function to run against all collection docs
     * @returns {array} all documents which pass your filter function
     * @memberof Collection
     */
    Collection.prototype.where = function (fun) {
      return this.chain().where(fun).data();
    };
    
// (Code skipped for WatermelonDB build)

    
// (Code skipped for WatermelonDB build)

    
// (Code skipped for WatermelonDB build)

    function UniqueIndex(uniqueField) {
      this.field = uniqueField;
      this.keyMap = Object.create(null);
      this.lokiMap = Object.create(null);
    }
    UniqueIndex.prototype.keyMap = {};
    UniqueIndex.prototype.lokiMap = {};
    UniqueIndex.prototype.set = function (obj) {
      var fieldValue = obj[this.field];
      if (fieldValue !== null && typeof (fieldValue) !== 'undefined') {
        if (this.keyMap[fieldValue]) {
          throw new Error('Duplicate key for property ' + this.field + ': ' + fieldValue);
        } else {
          this.keyMap[fieldValue] = obj;
          this.lokiMap[obj.$loki] = fieldValue;
        }
      }
    };
    UniqueIndex.prototype.get = function (key) {
      return this.keyMap[key];
    };

    UniqueIndex.prototype.byId = function (id) {
      return this.keyMap[this.lokiMap[id]];
    };
    /**
     * Updates a document's unique index given an updated object.
     * @param  {Object} obj Original document object
     * @param  {Object} doc New document object (likely the same as obj)
     */
    UniqueIndex.prototype.update = function (obj, doc) {
      if (this.lokiMap[obj.$loki] !== doc[this.field]) {
        var old = this.lokiMap[obj.$loki];
        this.set(doc);
        // make the old key fail bool test, while avoiding the use of delete (mem-leak prone)
        this.keyMap[old] = undefined;
      } else {
        this.keyMap[obj[this.field]] = doc;
      }
    };
    UniqueIndex.prototype.remove = function (key) {
      var obj = this.keyMap[key];
      if (obj !== null && typeof obj !== 'undefined') {
        // avoid using `delete`
        this.keyMap[key] = undefined;
        this.lokiMap[obj.$loki] = undefined;
      } else {
        throw new Error('Key is not in unique index: ' + this.field);
      }
    };
    UniqueIndex.prototype.clear = function () {
      this.keyMap = Object.create(null);
      this.lokiMap = Object.create(null);
    };
    
// (Code skipped for WatermelonDB build)

    Loki.deepFreeze = deepFreeze;
    Loki.freeze = freeze;
    Loki.unFreeze = unFreeze;
    Loki.LokiOps = LokiOps;
    Loki.Collection = Collection;
    
// (Code skipped for WatermelonDB build)

    Loki.Resultset = Resultset;
    
// (Code skipped for WatermelonDB build)

    Loki.LokiMemoryAdapter = LokiMemoryAdapter;
    
// (Code skipped for WatermelonDB build)

    Loki.aeq = aeqHelper;
    Loki.lt = ltHelper;
    Loki.gt = gtHelper;
    Loki.Comparators = Comparators;
    return Loki;
  }());

}));
