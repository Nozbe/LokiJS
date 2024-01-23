// this is just a test file for trying out the window.crypto

console.clear();
const runDemo = async() => {

    const encoder = new TextEncoder("utf-8");
    const decoder = new TextDecoder("utf-8");

    //
    // Configure the encryption algorithm to use
    //
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const algorithm = {
        iv,
        name: 'AES-GCM',
    };

    //
    // Generate/fetch the cryptographic key
    //
    function getKeyMaterial() {
        let input = 'the-username' + new Date();
        let enc = new TextEncoder();
        return window.crypto.subtle.importKey(
            "raw",
            enc.encode(input), {
                name: "PBKDF2"
            },
            false, ["deriveBits", "deriveKey"]
        );
    }

    let keyMaterial = await getKeyMaterial();
    let salt = window.crypto.getRandomValues(new Uint8Array(16));

    let key = await window.crypto.subtle.deriveKey({
            "name": "PBKDF2",
            salt: salt,
            "iterations": 100000,
            "hash": "SHA-256"
        },
        keyMaterial, {
            "name": "AES-GCM",
            "length": 256
        },
        true, ["encrypt", "decrypt"]
    );



    //
    // Export Key
    //
    const exportedKey = await window.crypto.subtle.exportKey(
        'raw',
        key,
    );

    // This is where to save the exported key to the back-end server,
    // and then to fetch the exported key from the back-end server.

    //
    // Import Key
    //
    const importedKey = await window.crypto.subtle.importKey(
        'raw',
        exportedKey,
        "AES-GCM",
        true, [
            "encrypt",
            "decrypt"
        ]
    );

    function ab2str(buf) {
        return String.fromCharCode.apply(null, new Uint8Array(buf));
    }

    function str2ab(str) {
        const buf = new ArrayBuffer(str.length); // 2 bytes for each char
        const bufView = new Uint8Array(buf);
        let i = 0;
        const strLen = str.length;
        for (; i<strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    }

    return {
        async encrypt(s) {
            const messageEncryptedUTF8 = await window.crypto.subtle.encrypt(
                algorithm,
                key,
                encoder.encode(s),
            );
            return btoa(ab2str(messageEncryptedUTF8));
        },
        async decrypt(s) {
            const messageDecryptedUTF8 = await window.crypto.subtle.decrypt(
                algorithm,
                importedKey,
                str2ab(atob(s))
            );
            return decoder.decode(messageDecryptedUTF8)
        }
    }
};

runDemo().then(async r => {
    try {
        console.log('gonna cypher bob');
        const ciphertext = await r.encrypt('bob');
        console.log(ciphertext);
        console.log(await r.decrypt(ciphertext));
    } catch (e) { console.log('err', e) }
}).catch(e => console.log('err', e));