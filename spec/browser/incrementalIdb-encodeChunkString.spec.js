// noinspection JSVoidFunctionReturnValueUsed

function deleteDb(dbName) {
    return new Promise(function(resolve, reject) {
        const deleteDbRequest = indexedDB.deleteDatabase(dbName);
        deleteDbRequest.addEventListener('error', function (e) {
            console.log('delete error', e);
            reject(e);
        });
        deleteDbRequest.addEventListener('blocked', function (e) {
            console.log('delete blocked', e);
            reject(e);
        });
        deleteDbRequest.addEventListener('upgradeneeded', function (e) {
            console.log('delete upgradeneeded', e);
            reject(e);
        });
        deleteDbRequest.addEventListener('success', function (e) {
            // console.log('delete success', e);
            resolve(e);
        });
    })
}


function getAllLokiObjects(dbName) {
    return new Promise(function(resolve, reject) {
        const openReq = indexedDB.open(dbName)
        openReq.onerror = function(event) {
            reject({type: 'onerror', event: event});
        }
        openReq.onupgradeneeded = function(event) {
            reject({type: 'onupgradeneeded', event: event});
        }
        openReq.onsuccess = function() {
            const db = openReq.result;
            const storeName = db.objectStoreNames[0];
            const queryReq = db.transaction(storeName).objectStore(storeName).getAll();
            queryReq.onsuccess = function(event){
                resolve(event.target.result)
            };
            queryReq.onerror = function(event){
                reject({type: 'getAll.onerror', event: event})
            };
        }
    });
}

const expectedModifiedAllObjects = function(dbName, loki, chunk, metadata) {
    if (loki === undefined) loki = "loki"
    if (chunk === undefined) chunk = "chunk"
    if (metadata === undefined) metadata = "metadata"
    return sortByKey([
        {key:"another." + chunk + ".0",   value:"[{\"a\":1,\"b\":2,\"meta\":{\"revision\":0,\"created\":9999999999999,\"version\":0},\"$loki\":1}]"},
        {key:"another." + metadata + "",  value:"{\"name\":\"another\",\"data\":[],\"idIndex\":[],\"binaryIndices\":{},\"constraints\":null,\"uniqueNames\":[],\"transforms\":{},\"objType\":\"another\",\"dirty\":true,\"cachedIndex\":null,\"cachedBinaryIndex\":null,\"cachedData\":null,\"adaptiveBinaryIndices\":true,\"transactional\":false,\"cloneObjects\":false,\"cloneMethod\":\"parse-stringify\",\"asyncListeners\":false,\"disableMeta\":false,\"disableChangesApi\":true,\"disableDeltaChangesApi\":true,\"autoupdate\":false,\"serializableIndices\":true,\"disableFreeze\":true,\"ttl\":null,\"maxId\":1,\"DynamicViews\":[],\"events\":{\"insert\":[],\"update\":[],\"pre-insert\":[],\"pre-update\":[],\"close\":[],\"flushbuffer\":[],\"error\":[],\"delete\":[null],\"warning\":[null]},\"changes\":[],\"dirtyIds\":[],\"idbVersionId\":\"aaaaaaaaaa\"}"},
        {key:loki + "",              value:"{\"filename\":\""+ dbName + "\",\"collections\":[{\"name\":\"testcoll\"},{\"name\":\"another\"}],\"databaseVersion\":1.5,\"engineVersion\":1.5,\"autosave\":false,\"autosaveInterval\":5000,\"autosaveHandle\":null,\"throttledSaves\":true,\"options\":{\"env\":\"NA\",\"serializationMethod\":\"normal\",\"destructureDelimiter\":\"$<\\n\"},\"persistenceAdapter\":null,\"throttledSavePending\":false,\"throttledCallbacks\":[],\"verbose\":false,\"events\":{\"init\":[null],\"loaded\":[],\"flushChanges\":[],\"close\":[],\"changes\":[],\"warning\":[]},\"ENV\":\"NA\",\"idbVersionId\":\"aaaaaaaaaa\"}"},
        {key:"testcoll." + chunk + ".0",  value:"[{\"name\":\"test1\",\"val\":100,\"meta\":{\"revision\":0,\"created\":9999999999999,\"version\":0},\"$loki\":1},{\"name\":\"test2\",\"val\":101,\"meta\":{\"revision\":0,\"created\":9999999999999,\"version\":0},\"$loki\":2},{\"name\":\"test3\",\"val\":102,\"meta\":{\"revision\":0,\"created\":9999999999999,\"version\":0},\"$loki\":3}]"},
        {key:"testcoll." + metadata + "", value:"{\"name\":\"testcoll\",\"data\":[],\"idIndex\":[],\"binaryIndices\":{},\"constraints\":null,\"uniqueNames\":[],\"transforms\":{},\"objType\":\"testcoll\",\"dirty\":true,\"cachedIndex\":null,\"cachedBinaryIndex\":null,\"cachedData\":null,\"adaptiveBinaryIndices\":true,\"transactional\":false,\"cloneObjects\":false,\"cloneMethod\":\"parse-stringify\",\"asyncListeners\":false,\"disableMeta\":false,\"disableChangesApi\":true,\"disableDeltaChangesApi\":true,\"autoupdate\":false,\"serializableIndices\":true,\"disableFreeze\":true,\"ttl\":null,\"maxId\":3,\"DynamicViews\":[],\"events\":{\"insert\":[],\"update\":[],\"pre-insert\":[],\"pre-update\":[],\"close\":[],\"flushbuffer\":[],\"error\":[],\"delete\":[null],\"warning\":[null]},\"changes\":[],\"dirtyIds\":[],\"idbVersionId\":\"aaaaaaaaaa\"}"}
    ])
};

function sortByKey(arr) {
    const newArr = arr.slice();
    return newArr.sort(function(a, b) {
        if ( a.key < b.key ){
            return -1;
        }
        if ( a.key > b.key ){
            return 1;
        }
        return 0;
    })
}

function repeatString(str, count) {
    var repeatedString = '';
    for (var i = 0; i < count; i++) {
        repeatedString += str;
    }
    return repeatedString;
}

const cipherkey = repeatString("x", 20); 
function base64Encode(s) {
    if (typeof CryptoJS !== "undefined") {
        return CryptoJS.Rabbit.encrypt(s, cipherkey).toString();
    }
    // noinspection JSDeprecatedSymbols
    return btoa(s);
}
function base64Decode(s) {
    if (typeof CryptoJS !== "undefined") {
        return CryptoJS.Rabbit.decrypt(s, cipherkey).toString(CryptoJS.enc.Utf8);
    }
    try {
        // noinspection JSDeprecatedSymbols
        return atob(s);
    } catch (e) {
        console.error('Error while base64 decoding the string', s);
        throw e;
    }
}

function replaceMutableValues(allLokiObjects) {
    return sortByKey(allLokiObjects.map(function(o) {
        const obj = {}
        for(var key in o) {
            if (o.hasOwnProperty(key)) {
                obj[key] = o[key];
            }
        }
        obj.value = o.value
            .replace(/"created":\d+/g, "\"created\":9999999999999")
            .replace(/"idbVersionId":"[a-z\d]+"/g, "\"idbVersionId\":\"aaaaaaaaaa\"")
        return (obj)
    }));
}

function verifyLokiDatabaseIsCreatedSavedAndLoadedSuccessfully(dbName, adapter, done, additionalAssertions) {
    const ddb = new loki(dbName, {adapter: adapter});

    const coll = ddb.addCollection("testcoll");
    coll.insert({name: "test1", val: 100});
    coll.insert({name: "test2", val: 101});
    coll.insert({name: "test3", val: 102});
    
    const coll2 = ddb.addCollection("another");
    coll2.insert({a: 1, b: 2});

    ddb.saveDatabase(function (e) {
        expect(e).toBeUndefined();

        const cdb = new loki(dbName, {adapter: adapter});
        const loadFunction = function() {
            new Promise(function(resolve, reject) {
                expect(cdb.collections.length).toEqual(2);
                expect(cdb.getCollection("testcoll").findOne({name: "test2"}).val).toEqual(101);
                expect(cdb.collections[0].data.length).toEqual(3);
                expect(cdb.collections[1].data.length).toEqual(1);

                additionalAssertions().then(function() {
                    done();
                    resolve();
                });
            })
        }
        cdb.loadDatabase({}, loadFunction);
    });
}

function createDeferredPromise(promiseReturningFunction) {
    // The promise is not created until this function is called
    var promise = promiseReturningFunction();

    promise.then(function(result) {
        // Handle the resolved value
        console.log("Resolved:", result);
    }).catch(function(error) {
        // Handle the error
        console.error("Rejected:", error);
    });
}

describe('IncrementalIndexedDBAdapter encode/decode chunk string functions', function () {

    afterEach(function() {
        console.log('--------------------')
    })

    it('verify basic IncrementalIndexedDBAdapter adapter functionality works', function(done) {
        window.__loki_incremental_idb_debug = true;
        const dbName = "test.db-basic";
        deleteDb(dbName).then(function() {
            const adapter = new IncrementalIndexedDBAdapter({});

            const additionalAssertions = function() {
                return new Promise(function(resolve, reject) {
                    getAllLokiObjects(dbName).then(function(allLokiObjects) {
                        expect(replaceMutableValues(allLokiObjects)).toEqual(expectedModifiedAllObjects(dbName));
                        resolve();
                    });
                })
            };

            verifyLokiDatabaseIsCreatedSavedAndLoadedSuccessfully(dbName, adapter, done, additionalAssertions);
        }).catch(function (e) { console.log('Error while deleting', dbName, e)})
    });

    it('encrypt and decrypt work - identity functions', function(done) {
        const dbName = "test.db.empty.encrypt.and.decrypt";
        deleteDb(dbName).then(function() {
            const adapter = new IncrementalIndexedDBAdapter({
                encrypt: async function (x) { return x; },
                decrypt: async function (x) { return x; },
            });

            const additionalAssertions = function() {
                return new Promise(function(resolve, reject) {
                    getAllLokiObjects(dbName).then(function(allLokiObjects) {
                        expect(replaceMutableValues(allLokiObjects)).toEqual(expectedModifiedAllObjects(dbName, "lk_____________", "ck", "md___"));
                        resolve();
                    });
                })
            }

            verifyLokiDatabaseIsCreatedSavedAndLoadedSuccessfully(dbName, adapter, done, additionalAssertions);
        }).catch(function (e) { console.log('Error while deleting', dbName, e)})
    });

    it('encrypt, decrypt and salt work', function(done) {
        const dbName = "test.db.encode.decode";
        deleteDb(dbName).then(function() {
            const adapter = new IncrementalIndexedDBAdapter({
                encrypt: async function(x) { return base64Encode(x); },
                decrypt: async function(x) { return base64Decode(x); },
            });

            const additionalAssertions = function() {
                return new Promise(function(resolve, reject) {
                    getAllLokiObjects(dbName).then(function(allLokiObjects) {
                        const allLokiObjectsDecoded = allLokiObjects.map(function(o){
                            return ({ key: o.key.split(".").map(function(x) {
                                if (isNaN(x))
                                    return base64Decode(x);
                                else
                                    return x
                            }).join("."), value: base64Decode(o.value) })
                        });
                        expect(replaceMutableValues(allLokiObjectsDecoded)).toEqual(expectedModifiedAllObjects(dbName, "lk_____________", "ck", "md___"));
                        resolve();
                    });
                })
            }

            verifyLokiDatabaseIsCreatedSavedAndLoadedSuccessfully(dbName, adapter, done, additionalAssertions);
        }).catch(function (e) { console.log('Error while deleting', dbName, e)})
    });

})