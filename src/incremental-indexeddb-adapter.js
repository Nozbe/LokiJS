// note: initial authors don't like Typescript but just don't tell them, shhh. Thing is that it
// seems like there is very little or close to no activity on upstream repositories which is why
// I don't really expect this to be merged and is one of the reason for deciding for it. This is
// far from being pretty or good but I wanted to make minimum change as much as possible. As a
// consequence this might not be the smallest script or optimized so keep that in mind if using.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
(function (root, factory) {
    if (typeof define === "function" && define.amd) {
        // AMD
        define([], factory);
    }
    else if (typeof exports === "object") {
        // CommonJS
        module.exports = factory();
    }
    else {
        // Browser globals
        root.IncrementalIndexedDBAdapter = factory();
    }
})(this, function () {
    return (function () {
        "use strict";
        /* jshint -W030 */
        var DEBUG = typeof window !== 'undefined' && !!window.__loki_incremental_idb_debug;
        /**
         * An improved Loki persistence adapter for IndexedDB (not compatible with LokiIndexedAdapter)
         *     Unlike LokiIndexedAdapter, the database is saved not as one big JSON blob, but split into
         *     small chunks with individual collection documents. When saving, only the chunks with changed
         *     documents (and database metadata) is saved to IndexedDB. This speeds up small incremental
         *     saves by an order of magnitude on large (tens of thousands of records) databases. It also
         *     avoids Safari 13 bug that would cause the database to balloon in size to gigabytes
         *
         *     The `appname` argument is not provided - to distinguish between multiple app on the same
         *     domain, simply use a different Loki database name
         *
         * @example
         * var adapter = new IncrementalIndexedDBAdapter();
         *
         * @constructor IncrementalIndexedDBAdapter
         *
         * @param {object=} options Configuration options for the adapter
         * @param {function} options.onversionchange Function to call on `IDBDatabase.onversionchange` event
         *     (most likely database deleted from another browser tab)
         * @param {function} options.onFetchStart Function to call once IDB load has begun.
         *     Use this as an opportunity to execute code concurrently while IDB does work on a separate thread
         * @param {function} options.onDidOverwrite Called when this adapter is forced to overwrite contents
         *     of IndexedDB. This happens if there's another open tab of the same app that's making changes.
         *     You might use it as an opportunity to alert user to the potential loss of data
         * @param {function} options.serializeChunk Called with a chunk (array of Loki documents) before
         *     it's saved to IndexedDB. You can use it to manually compress on-disk representation
         *     for faster database loads. Hint: Hand-written conversion of objects to arrays is very
         *     profitable for performance. If you use this, you must also pass options.deserializeChunk.
         * @param {function} options.deserializeChunk Called with a chunk serialized with options.serializeChunk
         *     Expects an array of Loki documents as the return value
         * @param {number} options.megachunkCount Number of parallel requests for data when loading database.
         *     Can be tuned for a specific application
         * @param {function} options.encrypt Called on each collection name or chunk string (after serialization),
         *     before saving into IDB.
         * @param {function} options.decrypt Called on each collecion name or chunk string after retrieval from IDB.
         */
        function IncrementalIndexedDBAdapter(options) {
            const that = this;
            this.mode = "incremental";
            this.options = options || {};
            this.chunkSize = 100;
            this.megachunkCount = this.options.megachunkCount || 20;
            this.idb = null; // will be lazily loaded on first operation that needs it
            this.idbActualLokiObjectStoreName = null; // will be lazily loaded, same as .idb
            this.keyResolver = null; // will be lazily loaded, same as .idb
            this._prevLokiVersionId = null;
            this._prevCollectionVersionIds = {};
            var shouldSetupEncryption = !!this.options.encrypt;
            if (shouldSetupEncryption) {
                if (shouldSetupEncryption && !this.options.decrypt) {
                    throw Error('encrypt was provided, but decrypt was not. You must pass both functions.');
                }
                if (shouldSetupEncryption && !isFunction(this.options.encrypt)) {
                    throw Error('encrypt was provided, but it is not an async function!');
                }
                if (shouldSetupEncryption && !isFunction(this.options.decrypt)) {
                    throw Error('decrypt was provided, but it is not an async function!');
                }
                this.encrypt = makeExternalFunctionSafe(this.options.encrypt, function (a) { return 'Error while invoking encrypt function. Supplied args: ' + a; });
                this.decrypt = makeExternalFunctionSafe(this.options.decrypt, function (a) { return 'Error while invoking decrypt function. Is the data really encrypted? Supplied args: ' + a; });
                // not perfect and could cause problems
                this.encrypt('test').then(result => {
                    that.encryptOutputsString = (typeof result === 'string');
                });
                this._names = {
                    objectStoreName: "LID",
                    lokiKeyName: "lk_____________", // some padding to give it roughly the same length as <tablename>.ck.<number>, so that is is indistinguishable
                    chunk: "ck",
                    metadata: "md___" // padding for the same reason as lokiKeyName
                };
            }
            else {
                this.encrypt = doNothing;
                this.decrypt = doNothing;
                this.encrypt('test').then(result => {
                    that.encryptOutputsString = (typeof result === 'string');
                });
                this._names = {
                    objectStoreName: "LokiIncrementalData",
                    lokiKeyName: "loki",
                    chunk: "chunk",
                    metadata: "metadata"
                };
            }
            if (!(this.megachunkCount >= 4 && this.megachunkCount % 2 === 0)) {
                throw new Error('megachunkCount must be >=4 and divisible by 2');
            }
        }
        // chunkId - index of the data chunk - e.g. chunk 0 will be lokiIds 0-99
        IncrementalIndexedDBAdapter.prototype._getChunk = function (collection, chunkId) {
            // 0-99, 100-199, etc.
            var minId = chunkId * this.chunkSize;
            var maxId = minId + this.chunkSize - 1;
            // use idIndex to find first collection.data position within the $loki range
            collection.ensureId();
            var idIndex = collection.idIndex;
            var firstDataPosition = null;
            var max = idIndex.length - 1, min = 0, mid;
            while (idIndex[min] < idIndex[max]) {
                mid = (min + max) >> 1;
                if (idIndex[mid] < minId) {
                    min = mid + 1;
                }
                else {
                    max = mid;
                }
            }
            if (max === min && idIndex[min] >= minId && idIndex[min] <= maxId) {
                firstDataPosition = min;
            }
            if (firstDataPosition === null) {
                // no elements in this chunk
                return [];
            }
            // find last position
            // if loki IDs are contiguous (no removed elements), last position will be first + chunk - 1
            // (and we look back in case there are missing pieces)
            // TODO: Binary search (not as important as first position, worst case scanario is only chunkSize steps)
            var lastDataPosition = null;
            for (var i = firstDataPosition + this.chunkSize - 1; i >= firstDataPosition; i--) {
                if (idIndex[i] <= maxId) {
                    lastDataPosition = i;
                    break;
                }
            }
            // verify
            var firstElement = collection.data[firstDataPosition];
            if (!(firstElement && firstElement.$loki >= minId && firstElement.$loki <= maxId)) {
                throw new Error("broken invariant firstelement");
            }
            if (lastDataPosition === null) {
                throw new Error("Unexpected lastDataPosition");
            }
            var lastElement = collection.data[lastDataPosition];
            if (!(lastElement && lastElement.$loki >= minId && lastElement.$loki <= maxId)) {
                throw new Error("broken invariant lastElement");
            }
            // this will have *up to* 'this.chunkSize' elements (might have less, because $loki ids
            // will have holes when data is deleted)
            var chunkData = collection.data.slice(firstDataPosition, lastDataPosition + 1);
            if (chunkData.length > this.chunkSize) {
                throw new Error("broken invariant - chunk size");
            }
            return chunkData;
        };
        /**
         * Incrementally saves the database to IndexedDB
         *
         * @example
         * var idbAdapter = new IncrementalIndexedDBAdapter();
         * var db = new loki('test', { adapter: idbAdapter });
         * var coll = db.addCollection('testColl');
         * coll.insert({test: 'val'});
         * db.saveDatabase();
         *
         * @param {string} dbname - the name to give the serialized database
         * @param {function} getLokiCopy - returns copy of the Loki database
         * @param {function} callback - (Optional) callback passed obj.success with true or false
         * @memberof IncrementalIndexedDBAdapter
         */
        IncrementalIndexedDBAdapter.prototype.saveDatabase = function (dbname, getLokiCopy, callback) {
            return __awaiter(this, void 0, void 0, function* () {
                var that = this;
                if (!this.idb) {
                    this._initializeIDB(dbname, callback, function () {
                        that.saveDatabase(dbname, getLokiCopy, callback);
                    });
                    return;
                }
                if (this.operationInProgress) {
                    throw new Error("Error while saving to database - another operation is already in progress. Please use throttledSaves=true option on Loki object");
                }
                this.operationInProgress = true;
                DEBUG && console.log("saveDatabase - begin");
                DEBUG && console.time("saveDatabase");
                function finish(e) {
                    DEBUG && e && console.error(e);
                    DEBUG && console.timeEnd("saveDatabase");
                    that.operationInProgress = false;
                    callback(e);
                }
                // try..catch is required, e.g.:
                // InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.
                // (this may happen if another tab has called deleteDatabase)
                try {
                    var updatePrevVersionIds = function () {
                        console.error('Unexpected successful tx - cannot update previous version ids');
                    };
                    const initialLokiVersionId = yield that.getLokiVersionId();
                    // note that initialPureLokiObject can be encrypted
                    const initialPureLokiObject = yield idbRequestResult(that.getPureLokiObjectRequest());
                    var didOverwrite = false;
                    let maxChunkIds = undefined;
                    if (initialLokiVersionId !== that._prevLokiVersionId) {
                        DEBUG && console.warn('Another writer changed Loki IDB, using slow path...');
                        didOverwrite = true;
                        // Incrementally saving changed chunks breaks down if there is more than one writer to IDB
                        // (multiple tabs of the same web app), leading to data corruption. To fix that, we save all
                        // metadata chunks (loki + collections) with a unique ID on each save and remember it. Before
                        // the subsequent save, we read loki from IDB to check if its version ID changed. If not, we're
                        // guaranteed that persisted DB is consistent with our diff. Otherwise, we fall back to the slow
                        // path and overwrite *all* database chunks with our version. Both reading and writing must
                        // happen in the same IDB transaction for this to work.
                        // TODO: We can optimize the slow path by fetching collection metadata chunks and comparing their
                        // version IDs with those last seen by us. Since any change in collection data requires a metadata
                        // chunk save, we're guaranteed that if the IDs match, we don't need to overwrite chukns of this collection
                        // NOTE: We must fetch all keys to protect against a case where another tab has wrote more
                        // chunks whan we did -- if so, we must delete them.
                        const tx = this.idb.transaction([this.idbActualLokiObjectStoreName], "readwrite");
                        var store = tx.objectStore(this.idbActualLokiObjectStoreName);
                        const allKeys = yield idbRequestResult(store.getAllKeys());
                        maxChunkIds = yield getMaxChunkIds(allKeys, that.keyResolver);
                    }
                    const incremental = !maxChunkIds;
                    const chunkInfo = yield that._getLokiChanges(getLokiCopy(), incremental, maxChunkIds);
                    var tx = that.idb.transaction([that.idbActualLokiObjectStoreName], "readwrite");
                    tx.oncomplete = function () {
                        updatePrevVersionIds();
                        finish(undefined);
                        if (didOverwrite && that.options.onDidOverwrite) {
                            that.options.onDidOverwrite();
                        }
                    };
                    tx.onerror = function (e) {
                        finish(e);
                    };
                    tx.onabort = function (e) {
                        finish(e);
                    };
                    var store = tx.objectStore(that.idbActualLokiObjectStoreName);
                    // we recheck if there was version change
                    try {
                        idbReq(that.getPureLokiObjectRequest(tx), function (e) {
                            const latestPureLokiObject = e.target.result;
                            // we compare loki object and expect that version changed if it doesn't match. Reason for this is
                            // that to get version itself we would potentially be required to decrypt which in turn can be async.
                            // This can cause transaction to stop which would prevent all of this from working.
                            const lokiObjectsMatch = (latestPureLokiObject === undefined && initialPureLokiObject === undefined)
                                || (that.encryptOutputsString && (latestPureLokiObject === null || latestPureLokiObject === void 0 ? void 0 : latestPureLokiObject.value) === (initialPureLokiObject === null || initialPureLokiObject === void 0 ? void 0 : initialPureLokiObject.value))
                                || (!that.encryptOutputsString && arrayBuffersEqual(latestPureLokiObject === null || latestPureLokiObject === void 0 ? void 0 : latestPureLokiObject.value, initialPureLokiObject === null || initialPureLokiObject === void 0 ? void 0 : initialPureLokiObject.value));
                            if (lokiObjectsMatch) {
                                that._applyDBChanges(store, chunkInfo.dbChanges);
                                // Update last seen version IDs, but only after the transaction is successful
                                updatePrevVersionIds = function () {
                                    that._prevLokiVersionId = chunkInfo.lokiVersionId;
                                    chunkInfo.collectionVersionIds.forEach(function (collectionInfo) {
                                        that._prevCollectionVersionIds[collectionInfo.name] = collectionInfo.versionId;
                                    });
                                };
                                tx.commit && tx.commit();
                            }
                            else {
                                // something saved in between while we were preparing data (maybe multiple tabs?).
                                tx.abort();
                            }
                        }, function (error) {
                            tx.abort();
                            finish(error);
                        });
                    }
                    catch (error) {
                        tx.abort();
                        finish(error);
                    }
                }
                catch (error) {
                    finish(error);
                }
            });
        };
        // gets current largest chunk ID for each collection
        function getMaxChunkIds(allCiphertextKeys, keyResolver) {
            return __awaiter(this, void 0, void 0, function* () {
                const maxChunkIds = {};
                for (let ciphertextKey of allCiphertextKeys) {
                    // table.chunk.2317
                    if (yield keyResolver.isChunkKey(ciphertextKey)) {
                        var collection = keyResolver.getCollectionNameForCiphertextChunkKey(ciphertextKey);
                        var chunkId = extractChunkIdFromChunkKey(ciphertextKey) || 0;
                        var currentMax = maxChunkIds[collection];
                        if (!currentMax || chunkId > currentMax) {
                            maxChunkIds[collection] = chunkId;
                        }
                    }
                }
                return maxChunkIds;
            });
        }
        IncrementalIndexedDBAdapter.prototype.getPureLokiObjectRequest = function (tx = undefined) {
            if (!tx) {
                tx = this.idb.transaction([this.idbActualLokiObjectStoreName], "readwrite");
            }
            var store = tx.objectStore(this.idbActualLokiObjectStoreName);
            return store.get(this.keyResolver.actualLokiKey);
        };
        IncrementalIndexedDBAdapter.prototype.getLokiVersionId = function (tx = undefined) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!tx) {
                    tx = this.idb.transaction([this.idbActualLokiObjectStoreName], "readwrite");
                }
                var store = tx.objectStore(this.idbActualLokiObjectStoreName);
                const chunk = yield idbRequestResult(store.get(this.keyResolver.actualLokiKey));
                return yield lokiChunkVersionId(chunk, this.decrypt);
            });
        };
        function lokiChunkVersionId(chunk, decryptFn) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    if (chunk) {
                        var loki = JSON.parse(yield decryptFn(chunk.value));
                        return loki.idbVersionId || null;
                    }
                    else {
                        return null;
                    }
                }
                catch (e) {
                    console.error('Error while parsing loki chunk', e);
                    return null;
                }
            });
        }
        IncrementalIndexedDBAdapter.prototype._getLokiChanges = function (loki, incremental, maxChunkIds) {
            return __awaiter(this, void 0, void 0, function* () {
                var that = this;
                var collectionVersionIds = [];
                var savedSize = 0;
                var prepareCollection = function (collection, i) {
                    return __awaiter(this, void 0, void 0, function* () {
                        // Find dirty chunk ids
                        var dirtyChunks = new Set();
                        incremental && collection.dirtyIds.forEach(function (lokiId) {
                            var chunkId = (lokiId / that.chunkSize) | 0;
                            dirtyChunks.add(chunkId);
                        });
                        collection.dirtyIds = [];
                        const putChunks = [];
                        const deleteChunkNames = [];
                        // Serialize chunks to save
                        var prepareChunk = function (chunkId) {
                            return __awaiter(this, void 0, void 0, function* () {
                                var chunkData = that._getChunk(collection, chunkId);
                                if (that.options.serializeChunk) {
                                    chunkData = that.options.serializeChunk(collection.name, chunkData);
                                }
                                // we must stringify now, because IDB is asynchronous, and underlying objects are mutable
                                // In general, it's also faster to stringify, because we need serialization anyway, and
                                // JSON.stringify is much better optimized than IDB's structured clone
                                chunkData = yield that.encrypt(JSON.stringify(chunkData));
                                savedSize += that.encryptOutputsString ? chunkData.length : chunkData.byteLength;
                                DEBUG && incremental && console.log('Saving: ' + collection.name + ".chunk." + chunkId);
                                try {
                                    putChunks.push({
                                        key: yield that.keyResolver.getOrGenerateCiphertextCollectionChunkKey(collection.name, chunkId),
                                        value: chunkData,
                                    });
                                }
                                catch (e) {
                                    console.error(e);
                                }
                            });
                        };
                        if (incremental) {
                            for (let dirtyChunk of dirtyChunks) {
                                yield prepareChunk(dirtyChunk);
                            }
                        }
                        else {
                            // add all chunks
                            var maxChunkId = (collection.maxId / that.chunkSize) | 0;
                            for (var j = 0; j <= maxChunkId; j += 1) {
                                yield prepareChunk(j);
                            }
                            // delete chunks with larger ids than what we have
                            // NOTE: we don't have to delete metadata chunks as they will be absent from loki anyway
                            // NOTE: failures are silently ignored, so we don't have to worry about holes
                            var persistedMaxChunkId = maxChunkIds[collection.name] || 0;
                            for (var k = maxChunkId + 1; k <= persistedMaxChunkId; k += 1) {
                                var deletedChunkName = yield that.keyResolver.getOrGenerateCiphertextCollectionChunkKey(collection.name, k);
                                deleteChunkNames.push(deletedChunkName);
                                DEBUG && console.warn('Deleted chunk: ' + deletedChunkName);
                            }
                        }
                        // save collection metadata as separate chunk (but only if changed)
                        if (collection.dirty || dirtyChunks.size || !incremental) {
                            collection.idIndex = []; // this is recreated lazily
                            collection.data = [];
                            collection.idbVersionId = randomVersionId();
                            collectionVersionIds.push({ name: collection.name, versionId: collection.idbVersionId });
                            var metadataChunk = yield that.encrypt(JSON.stringify(collection));
                            savedSize += that.encryptOutputsString ? metadataChunk.length : metadataChunk.byteLength;
                            DEBUG && incremental && console.log('Saving: ' + collection.name + ".metadata");
                            putChunks.push({
                                key: yield that.keyResolver.getOrGenerateCiphertextCollectionMetadataKey(collection.name),
                                value: metadataChunk,
                            });
                        }
                        // leave only names in the loki chunk
                        loki.collections[i] = { name: collection.name };
                        return { putChunks, deleteChunkNames };
                    });
                };
                const collectionsChanges = yield Promise.all(loki.collections.map((collection, index) => prepareCollection(collection, index)));
                loki.idbVersionId = randomVersionId();
                var serializedMetadata = yield that.encrypt(JSON.stringify(loki));
                savedSize += that.encryptOutputsString ? serializedMetadata.length : serializedMetadata.byteLength;
                DEBUG && incremental && console.log('Saving: loki');
                const lokiChunk = { key: that.keyResolver.actualLokiKey, value: serializedMetadata };
                DEBUG && console.log("expected saved size: " + savedSize);
                return {
                    lokiVersionId: loki.idbVersionId,
                    collectionVersionIds: collectionVersionIds,
                    dbChanges: {
                        collectionsChanges: collectionsChanges,
                        lokiChunk,
                    },
                };
            });
        };
        IncrementalIndexedDBAdapter.prototype._applyDBChanges = function (idbStore, dbChanges) {
            return __awaiter(this, void 0, void 0, function* () {
                dbChanges.collectionsChanges.forEach(collectionChanges => {
                    collectionChanges.putChunks.forEach(putChunk => {
                        idbStore.put(putChunk);
                    });
                    collectionChanges.deleteChunkNames.forEach(deleteChunkName => {
                        idbStore.delete(deleteChunkName);
                        DEBUG && console.warn('Deleted chunk: ' + deleteChunkName);
                    });
                });
                idbStore.put(dbChanges.lokiChunk);
            });
        };
        /**
         * Retrieves a serialized db string from the catalog.
         *
         * @example
         * // LOAD
         * var idbAdapter = new IncrementalIndexedDBAdapter();
         * var db = new loki('test', { adapter: idbAdapter });
         * db.loadDatabase(function(result) {
         *   console.log('done');
         * });
         *
         * @param {string} dbname - the name of the database to retrieve.
         * @param {function} callback - callback should accept string param containing serialized db string.
         * @memberof IncrementalIndexedDBAdapter
         */
        IncrementalIndexedDBAdapter.prototype.loadDatabase = function (dbname, callback) {
            return __awaiter(this, void 0, void 0, function* () {
                var that = this;
                if (this.operationInProgress) {
                    throw new Error("Error while loading database - another operation is already in progress. Please use throttledSaves=true option on Loki object");
                }
                this.operationInProgress = true;
                DEBUG && console.log("loadDatabase - begin");
                DEBUG && console.time("loadDatabase");
                var finish = function (value) {
                    DEBUG && console.timeEnd("loadDatabase");
                    that.operationInProgress = false;
                    callback(value);
                };
                yield this._getAllChunks(dbname, function (chunks) {
                    return __awaiter(this, void 0, void 0, function* () {
                        try {
                            if (!Array.isArray(chunks)) {
                                throw chunks; // we have an error
                            }
                            if (!chunks.length) {
                                return finish(null);
                            }
                            DEBUG && console.log("Found chunks:", chunks.length);
                            // repack chunks into a map
                            chunks = yield chunksToMap(chunks, that.keyResolver);
                            var loki = chunks.loki;
                            chunks.loki = null; // gc
                            // populate collections with data
                            populateLoki(loki, chunks.chunkMap);
                            chunks = null; // gc
                            // remember previous version IDs
                            that._prevLokiVersionId = loki.idbVersionId || null;
                            that._prevCollectionVersionIds = {};
                            loki.collections.forEach(function (collection) {
                                that._prevCollectionVersionIds[collection.name] = collection.idbVersionId || null;
                            });
                            return finish(loki);
                        }
                        catch (error) {
                            that._prevLokiVersionId = null;
                            that._prevCollectionVersionIds = {};
                            return finish(error);
                        }
                    });
                });
            });
        };
        function chunksToMap(chunks, keyResolver) {
            return __awaiter(this, void 0, void 0, function* () {
                var loki;
                var chunkMap = {};
                yield sortChunksInPlace(chunks, keyResolver);
                for (let object of chunks) {
                    var key = object.key;
                    var value = object.value;
                    if (keyResolver.isLokiKey(key)) {
                        loki = value;
                        continue;
                    }
                    else {
                        if (yield keyResolver.isChunkKey(key)) {
                            var colName = keyResolver.getCollectionNameForCiphertextChunkKey(key);
                            if (chunkMap[colName]) {
                                chunkMap[colName].dataChunks.push(value);
                            }
                            else {
                                chunkMap[colName] = {
                                    metadata: null,
                                    dataChunks: [value],
                                };
                            }
                            continue;
                        }
                        if (keyResolver.isMetadataKey(key)) {
                            var name = keyResolver.getCollectionNameForMetadataKey(key);
                            if (chunkMap[name]) {
                                chunkMap[name].metadata = value;
                            }
                            else {
                                chunkMap[name] = { metadata: value, dataChunks: [] };
                            }
                            continue;
                        }
                    }
                    console.error("Unknown chunk " + key);
                    throw new Error("Corrupted database - unknown chunk found");
                }
                ;
                if (!loki) {
                    throw new Error("Corrupted database - missing database metadata");
                }
                return { loki: loki, chunkMap: chunkMap };
            });
        }
        function populateLoki(loki, chunkMap) {
            loki.collections.forEach(function populateCollection(collectionStub, i) {
                var chunkCollection = chunkMap[collectionStub.name];
                if (chunkCollection) {
                    if (!chunkCollection.metadata) {
                        throw new Error("Corrupted database - missing metadata chunk for " + collectionStub.name);
                    }
                    var collection = chunkCollection.metadata;
                    chunkCollection.metadata = null;
                    loki.collections[i] = collection;
                    var dataChunks = chunkCollection.dataChunks;
                    dataChunks.forEach(function populateChunk(chunk, i) {
                        chunk.forEach(function (doc) {
                            collection.data.push(doc);
                        });
                        dataChunks[i] = null;
                    });
                }
            });
        }
        IncrementalIndexedDBAdapter.prototype._initializeIDB = function (dbname, onError, onSuccess) {
            return __awaiter(this, void 0, void 0, function* () {
                var that = this;
                DEBUG && console.log("initializing idb");
                if (this.idbInitInProgress) {
                    throw new Error("Cannot open IndexedDB because open is already in progress");
                }
                this.idbInitInProgress = true;
                const encryptedObjectStoreName = yield that._encryptToString(that._names.objectStoreName);
                var openRequest = indexedDB.open(dbname, 1);
                openRequest.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    DEBUG && console.log('onupgradeneeded, old version: ' + e.oldVersion);
                    if (e.oldVersion < 1) {
                        // Version 1 - Initial - Create database
                        db.createObjectStore(encryptedObjectStoreName, { keyPath: "key" });
                    }
                    else {
                        // Unknown version
                        throw new Error("Invalid old version " + e.oldVersion + " for IndexedDB upgrade");
                    }
                };
                openRequest.onsuccess = function (e) {
                    that.idbInitInProgress = false;
                    var db = e.target.result;
                    const objectStoreNames = db.objectStoreNames;
                    that.idb = db;
                    (() => __awaiter(this, void 0, void 0, function* () {
                        const idbActualLokiObjectStoreName = yield findIdbActualLokiObjectStoreName(objectStoreNames, that._names.objectStoreName, that._decryptFromString.bind(that));
                        that.idbActualLokiObjectStoreName = idbActualLokiObjectStoreName;
                        if (!that.idbActualLokiObjectStoreName) {
                            onError(new Error("Missing IndexedDB objectStore: " + that._names.objectStoreName + (that.decrypt ? ' (searched using decrypt function)' : '')));
                            // Attempt to recover (after reload) by deleting database, since it's damaged anyway
                            that.deleteDatabase(dbname);
                            return;
                        }
                        var tx = that.idb.transaction([that.idbActualLokiObjectStoreName], "readonly");
                        var store = tx.objectStore(that.idbActualLokiObjectStoreName);
                        const keyResolver = yield extractkeyResolver(store, that._names, that.encrypt, that._encryptToString.bind(that), that.decrypt, that._decryptFromString.bind(that));
                        that.keyResolver = keyResolver;
                        onSuccess();
                    }))();
                    try {
                        DEBUG && console.log("init success");
                        db.onversionchange = function (versionChangeEvent) {
                            // Ignore if database was deleted and recreated in the meantime
                            if (that.idb !== db) {
                                return;
                            }
                            DEBUG && console.log('IDB version change', versionChangeEvent);
                            // This function will be called if another connection changed DB version
                            // (Most likely database was deleted from another browser tab, unless there's a new version
                            // of this adapter, or someone makes a connection to IDB outside of this adapter)
                            // We must close the database to avoid blocking concurrent deletes.
                            // The database will be unusable after this. Be sure to supply `onversionchange` option
                            // to force logout
                            that.idb.close();
                            that.idb = null;
                            if (that.options.onversionchange) {
                                that.options.onversionchange(versionChangeEvent);
                            }
                        };
                    }
                    catch (e) {
                        console.error("Error while retrieving actual IDB lokiKeyName", e);
                        throw e;
                    }
                    ;
                };
                openRequest.onblocked = function (e) {
                    console.error("IndexedDB open is blocked", e);
                    onError(new Error("IndexedDB open is blocked by open connection"));
                };
                openRequest.onerror = function (e) {
                    that.idbInitInProgress = false;
                    console.error("IndexedDB open error", e);
                    onError(e);
                };
            });
        };
        IncrementalIndexedDBAdapter.prototype._getAllChunks = function (dbname, callback) {
            return __awaiter(this, void 0, void 0, function* () {
                var that = this;
                if (!this.idb) {
                    this._initializeIDB(dbname, callback, function () {
                        that._getAllChunks(dbname, callback);
                    });
                    return;
                }
                var tx = this.idb.transaction([that.idbActualLokiObjectStoreName], "readonly");
                var store = tx.objectStore(that.idbActualLokiObjectStoreName);
                // If there are a lot of chunks (>100), don't request them all in one go, but in multiple
                // "megachunks" (chunks of chunks). This improves concurrency, as main thread is already busy
                // while IDB process is still fetching data. Details: https://github.com/techfort/LokiJS/pull/874
                function getMegachunks(keys) {
                    return __awaiter(this, void 0, void 0, function* () {
                        var megachunkCount = that.megachunkCount;
                        var keyRanges = createKeyRanges(keys, megachunkCount);
                        var allChunks = [];
                        var megachunksReceived = 0;
                        function processMegachunk(megachunk, megachunkIndex, keyRange) {
                            return __awaiter(this, void 0, void 0, function* () {
                                // var debugMsg = 'processing chunk ' + megachunkIndex + ' (' + keyRange.lower + ' -- ' + keyRange.upper + ')'
                                // DEBUG && console.time(debugMsg);
                                for (let i = 0; i < megachunk.length; i++) {
                                    try {
                                        const chunk = megachunk[i];
                                        yield parseChunk(chunk, that.deserializeChunk, that.keyResolver, that.decrypt, that._decryptFromString.bind(that));
                                        allChunks.push(chunk);
                                        megachunk[i] = null; // gc
                                    }
                                    catch (e) {
                                        throw new Error(e);
                                    }
                                }
                                // DEBUG && console.timeEnd(debugMsg);
                                megachunksReceived += 1;
                                if (megachunksReceived === megachunkCount) {
                                    callback(allChunks);
                                }
                            });
                        }
                        // Stagger megachunk requests - first one half, then request the second when first one comes
                        // back. This further improves concurrency.
                        function requestMegachunk(index) {
                            return __awaiter(this, void 0, void 0, function* () {
                                var keyRange = keyRanges[index];
                                idbReq(store.getAll(keyRange), function (e) {
                                    if (index < megachunkCount / 2) {
                                        requestMegachunk(index + megachunkCount / 2);
                                    }
                                    const megachunk = e.target.result;
                                    processMegachunk(megachunk, index, keyRange);
                                }, function (e) {
                                    callback(e);
                                });
                            });
                        }
                        for (var i = 0; i < megachunkCount / 2; i += 1) {
                            yield requestMegachunk(i);
                        }
                    });
                }
                function getAllChunks() {
                    idbReq(store.getAll(), function (e) {
                        var allChunks = e.target.result;
                        (() => __awaiter(this, void 0, void 0, function* () {
                            yield Promise.all(allChunks.map(function (chunk) {
                                return __awaiter(this, void 0, void 0, function* () {
                                    yield parseChunk(chunk, that.deserializeChunk, that.keyResolver, that.decrypt, that._decryptFromString.bind(that));
                                });
                            }));
                            callback(allChunks);
                        }))();
                    }, function (e) {
                        callback(e);
                    });
                }
                function getAllKeys() {
                    idbReq(store.getAllKeys(), function (e) {
                        const keys = e.target.result;
                        if (keys.length > 100) {
                            // it is okay if this is sorted as 0, 1, 10, 100 and not 0, 1, 2...
                            var sortedKeys = keys.sort();
                            getMegachunks(sortedKeys);
                        }
                        else {
                            getAllChunks();
                        }
                    }, function (e) {
                        callback(e);
                    });
                    if (that.options.onFetchStart) {
                        that.options.onFetchStart();
                    }
                }
                getAllKeys();
            });
        };
        function parseChunk(chunk, deserializeChunk, keyResolver, decryptFn, decryptFromStringFn) {
            return __awaiter(this, void 0, void 0, function* () {
                if (typeof chunk.value === 'string') {
                    chunk.value = JSON.parse(yield decryptFromStringFn(chunk.value));
                }
                else {
                    chunk.value = JSON.parse(yield decryptFn(chunk.value));
                }
                if (deserializeChunk) {
                    if (yield keyResolver.isChunkKey(chunk.key)) {
                        var collectionName = keyResolver.getCollectionNameForCiphertextChunkKey(chunk.key);
                        chunk.value = deserializeChunk(collectionName, chunk.value);
                    }
                }
            });
        }
        /**
         * Deletes a database from IndexedDB
         *
         * @example
         * // DELETE DATABASE
         * // delete 'finance'/'test' value from catalog
         * idbAdapter.deleteDatabase('test', function {
         *   // database deleted
         * });
         *
         * @param {string} dbname - the name of the database to delete from IDB
         * @param {function=} callback - (Optional) executed on database delete
         * @memberof IncrementalIndexedDBAdapter
         */
        IncrementalIndexedDBAdapter.prototype.deleteDatabase = function (dbname, callback) {
            if (this.operationInProgress) {
                throw new Error("Error while deleting database - another operation is already in progress. Please use throttledSaves=true option on Loki object");
            }
            this.operationInProgress = true;
            var that = this;
            DEBUG && console.log("deleteDatabase - begin");
            DEBUG && console.time("deleteDatabase");
            this._prevLokiVersionId = null;
            this._prevCollectionVersionIds = {};
            if (this.idb) {
                this.idb.close();
                this.idb = null;
            }
            var request = indexedDB.deleteDatabase(dbname);
            request.onsuccess = function () {
                that.operationInProgress = false;
                DEBUG && console.timeEnd("deleteDatabase");
                callback({ success: true });
            };
            request.onerror = function (e) {
                that.operationInProgress = false;
                console.error("Error while deleting database", e);
                callback({ success: false });
            };
            request.onblocked = function (e) {
                // We can't call callback with failure status, because this will be called even if we
                // succeed in just a moment
                console.error("Deleting database failed because it's blocked by another connection", e);
            };
        };
        IncrementalIndexedDBAdapter.prototype._encryptToString = function (s) {
            return __awaiter(this, void 0, void 0, function* () {
                const encrypted = yield this.encrypt(s);
                if (this.encryptOutputsString) {
                    // encrypt algo already directly outputs string - not optimal but possible atm
                    return encrypted;
                }
                // trying to avoid spread to prevent max call stack size exceeded.
                let binary = '';
                const bytes = new Uint8Array(encrypted);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return window.btoa(binary);
            });
        };
        IncrementalIndexedDBAdapter.prototype._decryptFromString = function (s) {
            return __awaiter(this, void 0, void 0, function* () {
                if (this.encryptOutputsString) {
                    return yield this.decrypt(s);
                }
                const encrypted = Uint8Array.from(atob(s), c => c.charCodeAt(0));
                return yield this.decrypt(encrypted);
            });
        };
        function randomVersionId() {
            // Appears to have enough entropy for chunk version IDs
            // (Only has to be different than enough of its own previous versions that there's no writer
            // that thinks a new version is the same as an earlier one, not globally unique)
            return Math.random().toString(36).substring(2);
        }
        function _getSortKey(object, keyResolver) {
            return __awaiter(this, void 0, void 0, function* () {
                var key = object.key;
                if (yield keyResolver.isChunkKey(key)) {
                    return extractChunkIdFromChunkKey(key);
                }
                return -1; // consistent type must be returned
            });
        }
        function sortChunksInPlace(chunks, keyResolver) {
            return __awaiter(this, void 0, void 0, function* () {
                // sort chunks in place to load data in the right order (ascending loki ids)
                // on both Safari and Chrome, we'll get chunks in order like this: 0, 1, 10, 100...
                // we get sort keys in advance to prevent potentially decrypting multiple times
                const mapped = new Map(yield Promise.all(chunks.map((item) => __awaiter(this, void 0, void 0, function* () {
                    const sortKey = yield _getSortKey(item, keyResolver);
                    return [item.key, sortKey];
                }))));
                chunks.sort(function (a, b) {
                    const aKey = mapped.get(a.key), bKey = mapped.get(b.key);
                    if (!bKey)
                        return 1;
                    if (!aKey)
                        return -1;
                    if (aKey < bKey)
                        return -1;
                    if (aKey > bKey)
                        return 1;
                    return 0;
                });
            });
        }
        function createKeyRanges(keys, count) {
            var countPerRange = Math.floor(keys.length / count);
            var keyRanges = [];
            var minKey, maxKey;
            for (var i = 0; i < count; i += 1) {
                minKey = keys[countPerRange * i];
                maxKey = keys[countPerRange * (i + 1)];
                if (i === 0) {
                    // ... < maxKey
                    keyRanges.push(IDBKeyRange.upperBound(maxKey, true));
                }
                else if (i === count - 1) {
                    // >= minKey
                    keyRanges.push(IDBKeyRange.lowerBound(minKey));
                }
                else {
                    // >= minKey && < maxKey
                    keyRanges.push(IDBKeyRange.bound(minKey, maxKey, false, true));
                }
            }
            return keyRanges;
        }
        function idbReq(request, onsuccess, onerror) {
            request.onsuccess = function (e) {
                try {
                    return onsuccess(e);
                }
                catch (error) {
                    onerror(error);
                }
            };
            request.onerror = onerror;
            return request;
        }
        function idbRequestResult(request) {
            return new Promise((resolve, reject) => {
                request.onsuccess = function (e) {
                    resolve(e.target.result);
                };
                request.onerror = function (e) {
                    reject(e);
                };
            });
        }
        function findIdbActualLokiObjectStoreName(objectStoreNames, decryptedObjectStoreName, decryptFromStringFn) {
            return __awaiter(this, void 0, void 0, function* () {
                var domStringList = objectStoreNames;
                for (var i = 0; i < domStringList.length; i++) {
                    if ((yield decryptFromStringFn(domStringList[i])) === decryptedObjectStoreName) {
                        return domStringList[i];
                    }
                }
                return null;
            });
        }
        function isFunction(fn) {
            return typeof fn === 'function';
        }
        function arrayBuffersEqual(buffer1, buffer2) {
            if ((buffer1 === null || buffer1 === void 0 ? void 0 : buffer1.byteLength) !== (buffer2 === null || buffer2 === void 0 ? void 0 : buffer2.byteLength)) {
                return false;
            }
            const view1 = new Uint8Array(buffer1);
            const view2 = new Uint8Array(buffer2);
            for (let i = 0; i < view1.length; i++) {
                if (view1[i] !== view2[i]) {
                    return false;
                }
            }
            return true;
        }
        function doNothing(x) {
            return __awaiter(this, void 0, void 0, function* () { return x; });
        }
        function makeExternalFunctionSafe(fn, erroMessageGenerator) {
            return function () {
                try {
                    return fn.apply(this, arguments);
                }
                catch (e) {
                    console.error(erroMessageGenerator(arguments), e);
                    throw e;
                }
            };
        }
        function getChunkKeyWithoutChunkId(key) {
            var matchKeyWithoutChunkId = key.match(/^(.+)\.\d+$/);
            if (matchKeyWithoutChunkId === null) {
                return null;
            }
            return matchKeyWithoutChunkId[1];
        }
        function extractChunkIdFromChunkKey(key) {
            var chunkId = key.match(/^.+\.(\d+)$/);
            if (chunkId === null) {
                return null;
            }
            return parseInt(chunkId[1], 10);
        }
        function isCiphertextChunkKey(ciphertextChunkKey, _names, decryptFn, decryptFromStringFn) {
            return __awaiter(this, void 0, void 0, function* () {
                if (typeof ciphertextChunkKey !== 'string') {
                    return false;
                }
                var ciphertextChunkKeyWithoutChunkId = getChunkKeyWithoutChunkId(ciphertextChunkKey);
                if (!ciphertextChunkKeyWithoutChunkId) {
                    return false;
                }
                var plaintextChunkKeyWithoutChunkId = yield decryptFromStringFn(ciphertextChunkKeyWithoutChunkId);
                return isPlaintextChunkKeyWithoutChunkId(plaintextChunkKeyWithoutChunkId, _names);
            });
        }
        function isPlaintextChunkKeyWithoutChunkId(plaintextChunkKeyWithoutChunkId, _names) {
            return (plaintextChunkKeyWithoutChunkId.length - plaintextChunkKeyWithoutChunkId.lastIndexOf("." + _names.chunk) - ("." + _names.chunk).length) === 0;
        }
        function extractCollectionNameFromPlaintextChunkKey(plaintextChunkKey, _names) {
            var plaintextChunkKeyWithoutChunkId = getChunkKeyWithoutChunkId(plaintextChunkKey);
            if (!plaintextChunkKeyWithoutChunkId === null) {
                return null;
            }
            return extractCollectionNameFromPlaintextChunkKeyWithoutChunkId(plaintextChunkKeyWithoutChunkId, _names);
        }
        function extractCollectionNameFromPlaintextChunkKeyWithoutChunkId(plaintextChunkKeyWithoutChunkId, _names) {
            const lastIndexOfChunkKeyName = plaintextChunkKeyWithoutChunkId.lastIndexOf("." + _names.chunk);
            if (lastIndexOfChunkKeyName === -1) {
                throw new Error("Malformed chunk key without chunk id: " + plaintextChunkKeyWithoutChunkId + ". Could not find chunk term (" + _names.chunk + ")");
            }
            return plaintextChunkKeyWithoutChunkId.substring(0, lastIndexOfChunkKeyName);
        }
        function isPlaintextMetadataKey(plaintextMetadataKey, _names) {
            return (plaintextMetadataKey.length - plaintextMetadataKey.lastIndexOf("." + _names.metadata) - ("." + _names.metadata).length) === 0;
        }
        function extractCollectionNameFromPlaintextMetadataKey(plaintextMetadataKey, _names) {
            return plaintextMetadataKey.substring(0, plaintextMetadataKey.lastIndexOf("." + _names.metadata));
        }
        function extractkeyResolver(store, _names, encryptFn, encryptToStringFn, decryptFn, decryptFromStringFn) {
            var isEncriptionNotEnabled = !encryptFn;
            if (isEncriptionNotEnabled) {
                return new Promise(function (resolve) {
                    resolve({
                        actualLokiKey: _names.lokiKeyName,
                        isLokiKey: function (plaintextKey) {
                            return plaintextKey === _names.lokiKeyName;
                        },
                        isMetadataKey: function (plaintextKey) {
                            return isPlaintextMetadataKey(plaintextKey, _names);
                        },
                        isChunkKey: function (plaintextKey) {
                            return __awaiter(this, void 0, void 0, function* () {
                                var plaintextChunkKeyWithoutChunkId = getChunkKeyWithoutChunkId(plaintextKey);
                                if (!plaintextChunkKeyWithoutChunkId) {
                                    return false;
                                }
                                return isPlaintextChunkKeyWithoutChunkId(plaintextChunkKeyWithoutChunkId, _names);
                            });
                        },
                        getCollectionNameForMetadataKey: function (plaintextKey) {
                            return extractCollectionNameFromPlaintextMetadataKey(plaintextKey, _names);
                        },
                        getOrGenerateCiphertextCollectionMetadataKey: function (collectionName) {
                            return __awaiter(this, void 0, void 0, function* () {
                                return collectionName + "." + _names.metadata;
                            });
                        },
                        getCollectionNameForCiphertextChunkKey: function (key) {
                            return extractCollectionNameFromPlaintextChunkKey(key, _names);
                        },
                        getOrGenerateCiphertextCollectionChunkKey: function (collectionName, chunkId) {
                            return __awaiter(this, void 0, void 0, function* () {
                                return collectionName + "." + _names.chunk + "." + chunkId;
                            });
                        }
                    });
                });
            }
            return new Promise(function (resolve, reject) {
                idbReq(store.getAllKeys(), function (e) {
                    var keys = e.target.result;
                    (() => __awaiter(this, void 0, void 0, function* () {
                        var ciphertextLokiKey = null;
                        var plaintextCollectionNamesToCiphertextChunkKeysWithoutChunkId = {
                        /* plaintextCollectionName: ciphertextChunkKeyWithoutChunkId */
                        };
                        var keyResolver = {
                            ciphertextCollectionMetadataKeys: {
                            /* collectioName: ciphertextCollectionNameAndMetadataForThisCollection */
                            },
                            metadataCiphertextToCollectionName: {
                            /* ciphertextCollectionNameAndMetadataForThisCollection: collectionName */
                            },
                            chunkCiphertextToCollectionName: {
                            /* ciphertextCollectionNameAndChunkForThisCollection: collectionName */
                            }
                        };
                        if (keys.length === 0) {
                            // newly created database, we generate lokiKeyName and the others will be generated on-the-fly as needed
                            ciphertextLokiKey = yield encryptToStringFn(_names.lokiKeyName);
                        }
                        else {
                            for (var i = 0; i < keys.length; i++) {
                                const key = keys[i];
                                if (yield isCiphertextChunkKey(key, _names, decryptFn, decryptFromStringFn)) {
                                    var ciphertextChunkKeyWithoutChunkId = getChunkKeyWithoutChunkId(key);
                                    if (!ciphertextChunkKeyWithoutChunkId) {
                                        throw Error("Could not extract collection name from ciphertext chunk key: " + key + ". It did not match the [ciphertext].[chunkId] pattern.");
                                    }
                                    const plaintextCollectionName = extractCollectionNameFromPlaintextChunkKeyWithoutChunkId(yield decryptFromStringFn(ciphertextChunkKeyWithoutChunkId), _names);
                                    plaintextCollectionNamesToCiphertextChunkKeysWithoutChunkId[plaintextCollectionName] = ciphertextChunkKeyWithoutChunkId;
                                    keyResolver.chunkCiphertextToCollectionName[ciphertextChunkKeyWithoutChunkId] = plaintextCollectionName;
                                }
                                else {
                                    var plaintextKey = yield decryptFromStringFn(key);
                                    if (plaintextKey === _names.lokiKeyName) {
                                        ciphertextLokiKey = key;
                                    }
                                    else if (isPlaintextMetadataKey(plaintextKey, _names)) {
                                        var collectionName = extractCollectionNameFromPlaintextMetadataKey(plaintextKey, _names);
                                        keyResolver.ciphertextCollectionMetadataKeys[collectionName] = key;
                                        keyResolver.metadataCiphertextToCollectionName[key] = collectionName;
                                    }
                                    else {
                                        // todo maybe just warn
                                        throw Error('Error while loading keys from IDB: Unknown or malformed key (not chunk, loki or meta): ' + key + ' - Plaintext: ' + plaintextKey);
                                    }
                                }
                            }
                        }
                        if (ciphertextLokiKey) {
                            resolve({
                                actualLokiKey: ciphertextLokiKey,
                                metadataCiphertextToCollectionName: keyResolver.metadataCiphertextToCollectionName,
                                isLokiKey: function (ciphertextKey) {
                                    return ciphertextKey === ciphertextLokiKey;
                                },
                                isMetadataKey: function (ciphertextKey) {
                                    return !!keyResolver.metadataCiphertextToCollectionName[ciphertextKey];
                                },
                                isChunkKey: function (ciphertextKey) {
                                    return __awaiter(this, void 0, void 0, function* () {
                                        return yield isCiphertextChunkKey(ciphertextKey, _names, decryptFn, decryptFromStringFn);
                                    });
                                },
                                getCollectionNameForMetadataKey: function (ciphertextKey) {
                                    return keyResolver.metadataCiphertextToCollectionName[ciphertextKey];
                                },
                                getOrGenerateCiphertextCollectionMetadataKey: function (collectionName) {
                                    return __awaiter(this, void 0, void 0, function* () {
                                        if (!keyResolver.ciphertextCollectionMetadataKeys[collectionName]) {
                                            const metadataCiphertext = yield encryptToStringFn(collectionName + "." + _names.metadata);
                                            keyResolver.ciphertextCollectionMetadataKeys[collectionName] = metadataCiphertext;
                                            keyResolver.metadataCiphertextToCollectionName[metadataCiphertext] = collectionName;
                                        }
                                        return keyResolver.ciphertextCollectionMetadataKeys[collectionName];
                                    });
                                },
                                getCollectionNameForCiphertextChunkKey: function (key) {
                                    var keyWithoutChunkId = getChunkKeyWithoutChunkId(key);
                                    return keyResolver.chunkCiphertextToCollectionName[keyWithoutChunkId];
                                },
                                getOrGenerateCiphertextCollectionChunkKey: function (collectionName, chunkId) {
                                    return __awaiter(this, void 0, void 0, function* () {
                                        if (!plaintextCollectionNamesToCiphertextChunkKeysWithoutChunkId[collectionName]) {
                                            const ciphertextCollectionNameAndChunk = yield encryptToStringFn(collectionName + "." + _names.chunk);
                                            plaintextCollectionNamesToCiphertextChunkKeysWithoutChunkId[collectionName] = ciphertextCollectionNameAndChunk;
                                            keyResolver.chunkCiphertextToCollectionName[ciphertextCollectionNameAndChunk] = collectionName;
                                        }
                                        return plaintextCollectionNamesToCiphertextChunkKeysWithoutChunkId[collectionName] + "." + chunkId;
                                    });
                                }
                            });
                        }
                        else {
                            reject({ message: "Failed to resolve keyResolver. DB was not empty, a loki key with name '" + _names.lokiKeyName + "' is expected but was not found." });
                        }
                    }))();
                }, function (e) {
                    reject({ message: "Error on IDB getAllKeys request", e });
                });
            });
        }
        return IncrementalIndexedDBAdapter;
    })();
});
