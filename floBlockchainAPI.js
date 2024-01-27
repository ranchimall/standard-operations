(function (EXPORTS) { //floBlockchainAPI v3.1.4
    /* FLO Blockchain Operator to send/receive data from blockchain using API calls via FLO Blockbook*/
    'use strict';
    const floBlockchainAPI = EXPORTS;

    const DEFAULT = {
        blockchain: floGlobals.blockchain,
        apiURL: {
            FLO: ['https://blockbook.ranchimall.net/'],
            FLO_TEST: ['https://blockbook-testnet.ranchimall.net/']
        },
        sendAmt: 0.0003,
        fee: 0.0002,
        minChangeAmt: 0.0002,
        receiverID: floGlobals.adminID
    };

    const SATOSHI_IN_BTC = 1e8;
    const isUndefined = val => typeof val === 'undefined';

    const checkIfTor = floBlockchainAPI.checkIfTor = () => {
        return fetch('https://check.torproject.org/api/ip')
            .then(res => res.json())
            .then(res => {
                return res.IsTor
            }).catch(e => {
                console.error(e)
                return false
            })
    }
    let isTor = false;
    checkIfTor().then(result => {
        isTor = result
        if (isTor) {
            DEFAULT.apiURL.FLO.push('http://xge4kejxl6xs4cad3u3a7dnw7idndlkn3vmyo33t3a4ctk566y65eoad.onion/')
            DEFAULT.apiURL.FLO_TEST.push('http://fdjrsde2qhfecvx6fkgmcidwkp34bdek7jo4y2fpqatrhzxtxkk6f4ad.onion/')
        }
    });

    const util = floBlockchainAPI.util = {};

    util.Sat_to_FLO = value => parseFloat((value / SATOSHI_IN_BTC).toFixed(8));
    util.FLO_to_Sat = value => parseInt(value * SATOSHI_IN_BTC);
    util.toFixed = value => parseFloat((value).toFixed(8));

    Object.defineProperties(floBlockchainAPI, {
        sendAmt: {
            get: () => DEFAULT.sendAmt,
            set: amt => !isNaN(amt) ? DEFAULT.sendAmt = amt : null
        },
        fee: {
            get: () => DEFAULT.fee,
            set: fee => !isNaN(fee) ? DEFAULT.fee = fee : null
        },
        defaultReceiver: {
            get: () => DEFAULT.receiverID,
            set: floID => DEFAULT.receiverID = floID
        },
        blockchain: {
            get: () => DEFAULT.blockchain
        }
    });

    if (floGlobals.sendAmt) floBlockchainAPI.sendAmt = floGlobals.sendAmt;
    if (floGlobals.fee) floBlockchainAPI.fee = floGlobals.fee;

    Object.defineProperties(floGlobals, {
        sendAmt: {
            get: () => DEFAULT.sendAmt,
            set: amt => !isNaN(amt) ? DEFAULT.sendAmt = amt : null
        },
        fee: {
            get: () => DEFAULT.fee,
            set: fee => !isNaN(fee) ? DEFAULT.fee = fee : null
        }
    });

    const allServerList = new Set(floGlobals.apiURL && floGlobals.apiURL[DEFAULT.blockchain] ? floGlobals.apiURL[DEFAULT.blockchain] : DEFAULT.apiURL[DEFAULT.blockchain]);

    var serverList = Array.from(allServerList);
    var curPos = floCrypto.randInt(0, serverList.length - 1);

    function fetch_retry(apicall, rm_node) {
        return new Promise((resolve, reject) => {
            let i = serverList.indexOf(rm_node)
            if (i != -1) serverList.splice(i, 1);
            curPos = floCrypto.randInt(0, serverList.length - 1);
            fetch_api(apicall, false)
                .then(result => resolve(result))
                .catch(error => reject(error));
        })
    }

    function fetch_api(apicall, ic = true) {
        return new Promise((resolve, reject) => {
            if (serverList.length === 0) {
                if (ic) {
                    serverList = Array.from(allServerList);
                    curPos = floCrypto.randInt(0, serverList.length - 1);
                    fetch_api(apicall, false)
                        .then(result => resolve(result))
                        .catch(error => reject(error));
                } else
                    reject("No FLO blockbook server working");
            } else {
                let serverURL = serverList[curPos];
                fetch(serverURL + apicall).then(response => {
                    if (response.ok)
                        response.json().then(data => resolve(data));
                    else {
                        fetch_retry(apicall, serverURL)
                            .then(result => resolve(result))
                            .catch(error => reject(error));
                    }
                }).catch(error => {
                    fetch_retry(apicall, serverURL)
                        .then(result => resolve(result))
                        .catch(error => reject(error));
                })
            }
        })
    }

    Object.defineProperties(floBlockchainAPI, {
        serverList: {
            get: () => Array.from(serverList)
        },
        current_server: {
            get: () => serverList[curPos]
        }
    });

    //Promised function to get data from API
    const promisedAPI = floBlockchainAPI.promisedAPI = floBlockchainAPI.fetch = function (apicall, query_params = undefined) {
        return new Promise((resolve, reject) => {
            if (!isUndefined(query_params))
                apicall += '?' + new URLSearchParams(JSON.parse(JSON.stringify(query_params))).toString();
            //console.debug(apicall);
            fetch_api(apicall)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    }

    //Get balance for the given Address
    const getBalance = floBlockchainAPI.getBalance = function (addr) {
        return new Promise((resolve, reject) => {
            let api = `api/address/${addr}`;
            promisedAPI(api, { details: "basic" })
                .then(result => resolve(result["balance"]))
                .catch(error => reject(error))
        });
    }

    function getScriptPubKey(address) {
        var tx = bitjs.transaction();
        tx.addoutput(address, 0);
        let outputBuffer = tx.outputs.pop().script;
        return Crypto.util.bytesToHex(outputBuffer)
    }

    const getUTXOs = address => new Promise((resolve, reject) => {
        promisedAPI(`api/utxo/${address}`, { confirmed: true }).then(utxos => {
            let scriptPubKey = getScriptPubKey(address);
            utxos.forEach(u => u.scriptPubKey = scriptPubKey);
            resolve(utxos);
        }).catch(error => reject(error))
    })

    //create a transaction with single sender
    const createTx = function (senderAddr, receiverAddr, sendAmt, floData = '', strict_utxo = true) {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateASCII(floData))
                return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
            else if (!floCrypto.validateFloID(senderAddr, true))
                return reject(`Invalid address : ${senderAddr}`);
            else if (!floCrypto.validateFloID(receiverAddr))
                return reject(`Invalid address : ${receiverAddr}`);
            else if (typeof sendAmt !== 'number' || sendAmt <= 0)
                return reject(`Invalid sendAmt : ${sendAmt}`);

            getBalance(senderAddr).then(balance => {
                var fee = DEFAULT.fee;
                if (balance < sendAmt + fee)
                    return reject("Insufficient FLO balance!");
                getUTXOs(senderAddr).then(utxos => {
                    //form/construct the transaction data
                    var trx = bitjs.transaction();
                    var utxoAmt = 0.0;
                    for (var i = utxos.length - 1;
                        (i >= 0) && (utxoAmt < sendAmt + fee); i--) {
                        //use only utxos with confirmations (strict_utxo mode)
                        if (utxos[i].confirmations || !strict_utxo) {
                            trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                            utxoAmt += utxos[i].amount;
                        };
                    }
                    if (utxoAmt < sendAmt + fee)
                        reject("Insufficient FLO: Some UTXOs are unconfirmed");
                    else {
                        trx.addoutput(receiverAddr, sendAmt);
                        var change = utxoAmt - sendAmt - fee;
                        if (change > DEFAULT.minChangeAmt)
                            trx.addoutput(senderAddr, change);
                        trx.addflodata(floData.replace(/\n/g, ' '));
                        resolve(trx);
                    }
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    floBlockchainAPI.createTx = function (senderAddr, receiverAddr, sendAmt, floData = '', strict_utxo = true) {
        return new Promise((resolve, reject) => {
            createTx(senderAddr, receiverAddr, sendAmt, floData, strict_utxo)
                .then(trx => resolve(trx.serialize()))
                .catch(error => reject(error))
        })
    }

    //Send Tx to blockchain 
    const sendTx = floBlockchainAPI.sendTx = function (senderAddr, receiverAddr, sendAmt, privKey, floData = '', strict_utxo = true) {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateFloID(senderAddr, true))
                return reject(`Invalid address : ${senderAddr}`);
            else if (privKey.length < 1 || !floCrypto.verifyPrivKey(privKey, senderAddr))
                return reject("Invalid Private key!");
            createTx(senderAddr, receiverAddr, sendAmt, floData, strict_utxo).then(trx => {
                var signedTxHash = trx.sign(privKey, 1);
                broadcastTx(signedTxHash)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        });
    }

    //Write Data into blockchain
    floBlockchainAPI.writeData = function (senderAddr, data, privKey, receiverAddr = DEFAULT.receiverID, options = {}) {
        let strict_utxo = options.strict_utxo === false ? false : true,
            sendAmt = isNaN(options.sendAmt) ? DEFAULT.sendAmt : options.sendAmt;
        return new Promise((resolve, reject) => {
            if (typeof data != "string")
                data = JSON.stringify(data);
            sendTx(senderAddr, receiverAddr, sendAmt, privKey, data, strict_utxo)
                .then(txid => resolve(txid))
                .catch(error => reject(error));
        });
    }

    //merge all UTXOs of a given floID into a single UTXO
    floBlockchainAPI.mergeUTXOs = function (floID, privKey, floData = '') {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateFloID(floID, true))
                return reject(`Invalid floID`);
            if (!floCrypto.verifyPrivKey(privKey, floID))
                return reject("Invalid Private Key");
            if (!floCrypto.validateASCII(floData))
                return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
            var trx = bitjs.transaction();
            var utxoAmt = 0.0;
            var fee = DEFAULT.fee;
            getUTXOs(floID).then(utxos => {
                for (var i = utxos.length - 1; i >= 0; i--)
                    if (utxos[i].confirmations) {
                        trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                        utxoAmt += utxos[i].amount;
                    }
                trx.addoutput(floID, utxoAmt - fee);
                trx.addflodata(floData.replace(/\n/g, ' '));
                var signedTxHash = trx.sign(privKey, 1);
                broadcastTx(signedTxHash)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    //split sufficient UTXOs of a given floID for a parallel sending
    floBlockchainAPI.splitUTXOs = function (floID, privKey, count, floData = '') {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateFloID(floID, true))
                return reject(`Invalid floID`);
            if (!floCrypto.verifyPrivKey(privKey, floID))
                return reject("Invalid Private Key");
            if (!floCrypto.validateASCII(floData))
                return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
            var fee = DEFAULT.fee;
            var splitAmt = DEFAULT.sendAmt + fee;
            var totalAmt = splitAmt * count;
            getBalance(floID).then(balance => {
                var fee = DEFAULT.fee;
                if (balance < totalAmt + fee)
                    return reject("Insufficient FLO balance!");
                //get unconfirmed tx list
                getUTXOs(floID).then(utxos => {
                    var trx = bitjs.transaction();
                    var utxoAmt = 0.0;
                    for (let i = utxos.length - 1; (i >= 0) && (utxoAmt < totalAmt + fee); i--) {
                        //use only utxos with confirmations (strict_utxo mode)
                        if (utxos[i].confirmations || !strict_utxo) {
                            trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                            utxoAmt += utxos[i].amount;
                        };
                    }
                    if (utxoAmt < totalAmt + fee)
                        reject("Insufficient FLO: Some UTXOs are unconfirmed");
                    else {
                        for (let i = 0; i < count; i++)
                            trx.addoutput(floID, splitAmt);
                        var change = utxoAmt - totalAmt - fee;
                        if (change > DEFAULT.minChangeAmt)
                            trx.addoutput(floID, change);
                        trx.addflodata(floData.replace(/\n/g, ' '));
                        var signedTxHash = trx.sign(privKey, 1);
                        broadcastTx(signedTxHash)
                            .then(txid => resolve(txid))
                            .catch(error => reject(error))
                    }
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    /**Write data into blockchain from (and/or) to multiple floID
     * @param  {Array} senderPrivKeys List of sender private-keys
     * @param  {string} data FLO data of the txn
     * @param  {Array} receivers List of receivers
     * @param  {boolean} preserveRatio (optional) preserve ratio or equal contribution
     * @return {Promise}
     */
    floBlockchainAPI.writeDataMultiple = function (senderPrivKeys, data, receivers = [DEFAULT.receiverID], options = {}) {
        return new Promise((resolve, reject) => {
            if (!Array.isArray(senderPrivKeys))
                return reject("Invalid senderPrivKeys: SenderPrivKeys must be Array");
            if (options.preserveRatio === false) {
                let tmp = {};
                let amount = (DEFAULT.sendAmt * receivers.length) / senderPrivKeys.length;
                senderPrivKeys.forEach(key => tmp[key] = amount);
                senderPrivKeys = tmp;
            }
            if (!Array.isArray(receivers))
                return reject("Invalid receivers: Receivers must be Array");
            else {
                let tmp = {};
                let amount = options.sendAmt || DEFAULT.sendAmt;
                receivers.forEach(floID => tmp[floID] = amount);
                receivers = tmp
            }
            if (typeof data != "string")
                data = JSON.stringify(data);
            sendTxMultiple(senderPrivKeys, receivers, data)
                .then(txid => resolve(txid))
                .catch(error => reject(error))
        })
    }

    /**Send Tx from (and/or) to multiple floID
     * @param  {Array or Object} senderPrivKeys List of sender private-key (optional: with coins to be sent)
     * @param  {Object} receivers List of receivers with respective amount to be sent
     * @param  {string} floData FLO data of the txn
     * @return {Promise}
     */
    const sendTxMultiple = floBlockchainAPI.sendTxMultiple = function (senderPrivKeys, receivers, floData = '') {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateASCII(floData))
                return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
            let senders = {},
                preserveRatio;
            //check for argument validations
            try {
                let invalids = {
                    InvalidSenderPrivKeys: [],
                    InvalidSenderAmountFor: [],
                    InvalidReceiverIDs: [],
                    InvalidReceiveAmountFor: []
                }
                let inputVal = 0,
                    outputVal = 0;
                //Validate sender privatekeys (and send amount if passed)
                //conversion when only privateKeys are passed (preserveRatio mode)
                if (Array.isArray(senderPrivKeys)) {
                    senderPrivKeys.forEach(key => {
                        try {
                            if (!key)
                                invalids.InvalidSenderPrivKeys.push(key);
                            else {
                                let floID = floCrypto.getFloID(key);
                                senders[floID] = {
                                    wif: key
                                }
                            }
                        } catch (error) {
                            invalids.InvalidSenderPrivKeys.push(key)
                        }
                    })
                    preserveRatio = true;
                }
                //conversion when privatekeys are passed with send amount
                else {
                    for (let key in senderPrivKeys) {
                        try {
                            if (!key)
                                invalids.InvalidSenderPrivKeys.push(key);
                            else {
                                if (typeof senderPrivKeys[key] !== 'number' || senderPrivKeys[key] <= 0)
                                    invalids.InvalidSenderAmountFor.push(key);
                                else
                                    inputVal += senderPrivKeys[key];
                                let floID = floCrypto.getFloID(key);
                                senders[floID] = {
                                    wif: key,
                                    coins: senderPrivKeys[key]
                                }
                            }
                        } catch (error) {
                            invalids.InvalidSenderPrivKeys.push(key)
                        }
                    }
                    preserveRatio = false;
                }
                //Validate the receiver IDs and receive amount
                for (let floID in receivers) {
                    if (!floCrypto.validateFloID(floID))
                        invalids.InvalidReceiverIDs.push(floID);
                    if (typeof receivers[floID] !== 'number' || receivers[floID] <= 0)
                        invalids.InvalidReceiveAmountFor.push(floID);
                    else
                        outputVal += receivers[floID];
                }
                //Reject if any invalids are found
                for (let i in invalids)
                    if (!invalids[i].length)
                        delete invalids[i];
                if (Object.keys(invalids).length)
                    return reject(invalids);
                //Reject if given inputVal and outputVal are not equal
                if (!preserveRatio && inputVal != outputVal)
                    return reject(`Input Amount (${inputVal}) not equal to Output Amount (${outputVal})`);
            } catch (error) {
                return reject(error)
            }
            //Get balance of senders
            let promises = [];
            for (let floID in senders)
                promises.push(getBalance(floID));
            Promise.all(promises).then(results => {
                let totalBalance = 0,
                    totalFee = DEFAULT.fee,
                    balance = {};
                //Divide fee among sender if not for preserveRatio
                if (!preserveRatio)
                    var dividedFee = totalFee / Object.keys(senders).length;
                //Check if balance of each sender is sufficient enough
                let insufficient = [];
                for (let floID in senders) {
                    balance[floID] = parseFloat(results.shift());
                    if (isNaN(balance[floID]) || (preserveRatio && balance[floID] <= totalFee) ||
                        (!preserveRatio && balance[floID] < senders[floID].coins + dividedFee))
                        insufficient.push(floID);
                    totalBalance += balance[floID];
                }
                if (insufficient.length)
                    return reject({
                        InsufficientBalance: insufficient
                    })
                //Calculate totalSentAmount and check if totalBalance is sufficient
                let totalSendAmt = totalFee;
                for (let floID in receivers)
                    totalSendAmt += receivers[floID];
                if (totalBalance < totalSendAmt)
                    return reject("Insufficient total Balance");
                //Get the UTXOs of the senders
                let promises = [];
                for (let floID in senders)
                    promises.push(getUTXOs(floID));
                Promise.all(promises).then(results => {
                    var trx = bitjs.transaction();
                    for (let floID in senders) {
                        let utxos = results.shift();
                        let sendAmt;
                        if (preserveRatio) {
                            let ratio = (balance[floID] / totalBalance);
                            sendAmt = totalSendAmt * ratio;
                        } else
                            sendAmt = senders[floID].coins + dividedFee;
                        let utxoAmt = 0.0;
                        for (let i = utxos.length - 1;
                            (i >= 0) && (utxoAmt < sendAmt); i--) {
                            if (utxos[i].confirmations) {
                                trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                                utxoAmt += utxos[i].amount;
                            }
                        }
                        if (utxoAmt < sendAmt)
                            return reject("Insufficient balance:" + floID);
                        let change = (utxoAmt - sendAmt);
                        if (change > 0)
                            trx.addoutput(floID, change);
                    }
                    for (let floID in receivers)
                        trx.addoutput(floID, receivers[floID]);
                    trx.addflodata(floData.replace(/\n/g, ' '));
                    for (let floID in senders)
                        trx.sign(senders[floID].wif, 1);
                    var signedTxHash = trx.serialize();
                    broadcastTx(signedTxHash)
                        .then(txid => resolve(txid))
                        .catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    //Create a multisig transaction
    const createMultisigTx = function (redeemScript, receivers, amounts, floData = '', strict_utxo = true) {
        return new Promise((resolve, reject) => {
            var multisig = floCrypto.decodeRedeemScript(redeemScript);

            //validate multisig script and flodata
            if (!multisig)
                return reject(`Invalid redeemScript`);
            var senderAddr = multisig.address;
            if (!floCrypto.validateFloID(senderAddr))
                return reject(`Invalid multisig : ${senderAddr}`);
            else if (!floCrypto.validateASCII(floData))
                return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
            //validate receiver addresses
            if (!Array.isArray(receivers))
                receivers = [receivers];
            for (let r of receivers)
                if (!floCrypto.validateFloID(r))
                    return reject(`Invalid address : ${r}`);
            //validate amounts
            if (!Array.isArray(amounts))
                amounts = [amounts];
            if (amounts.length != receivers.length)
                return reject("Receivers and amounts have different length");
            var sendAmt = 0;
            for (let a of amounts) {
                if (typeof a !== 'number' || a <= 0)
                    return reject(`Invalid amount : ${a}`);
                sendAmt += a;
            }

            getBalance(senderAddr).then(balance => {
                var fee = DEFAULT.fee;
                if (balance < sendAmt + fee)
                    return reject("Insufficient FLO balance!");
                getUTXOs(senderAddr).then(utxos => {
                    //form/construct the transaction data
                    var trx = bitjs.transaction();
                    var utxoAmt = 0.0;
                    for (var i = utxos.length - 1;
                        (i >= 0) && (utxoAmt < sendAmt + fee); i--) {
                        //use only utxos with confirmations (strict_utxo mode)
                        if (utxos[i].confirmations || !strict_utxo) {
                            trx.addinput(utxos[i].txid, utxos[i].vout, redeemScript); //for multisig, script=redeemScript
                            utxoAmt += utxos[i].amount;
                        };
                    }
                    if (utxoAmt < sendAmt + fee)
                        reject("Insufficient FLO: Some UTXOs are unconfirmed");
                    else {
                        for (let i in receivers)
                            trx.addoutput(receivers[i], amounts[i]);
                        var change = utxoAmt - sendAmt - fee;
                        if (change > DEFAULT.minChangeAmt)
                            trx.addoutput(senderAddr, change);
                        trx.addflodata(floData.replace(/\n/g, ' '));
                        resolve(trx);
                    }
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        });
    }

    //Same as above, but explict call should return serialized tx-hex
    floBlockchainAPI.createMultisigTx = function (redeemScript, receivers, amounts, floData = '', strict_utxo = true) {
        return new Promise((resolve, reject) => {
            createMultisigTx(redeemScript, receivers, amounts, floData, strict_utxo)
                .then(trx => resolve(trx.serialize()))
                .catch(error => reject(error))
        })
    }

    //Create and send multisig transaction
    const sendMultisigTx = floBlockchainAPI.sendMultisigTx = function (redeemScript, privateKeys, receivers, amounts, floData = '', strict_utxo = true) {
        return new Promise((resolve, reject) => {
            var multisig = floCrypto.decodeRedeemScript(redeemScript);
            if (!multisig)
                return reject(`Invalid redeemScript`);
            if (privateKeys.length < multisig.required)
                return reject(`Insufficient privateKeys (required ${multisig.required})`);
            for (let pk of privateKeys) {
                var flag = false;
                for (let pub of multisig.pubkeys)
                    if (floCrypto.verifyPrivKey(pk, pub, false))
                        flag = true;
                if (!flag)
                    return reject(`Invalid Private key`);
            }
            createMultisigTx(redeemScript, receivers, amounts, floData, strict_utxo).then(trx => {
                for (let pk of privateKeys)
                    trx.sign(pk, 1);
                var signedTxHash = trx.serialize();
                broadcastTx(signedTxHash)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    floBlockchainAPI.writeMultisigData = function (redeemScript, data, privatekeys, receiverAddr = DEFAULT.receiverID, options = {}) {
        let strict_utxo = options.strict_utxo === false ? false : true,
            sendAmt = isNaN(options.sendAmt) ? DEFAULT.sendAmt : options.sendAmt;
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateFloID(receiverAddr))
                return reject(`Invalid receiver: ${receiverAddr}`);
            sendMultisigTx(redeemScript, privatekeys, receiverAddr, sendAmt, data, strict_utxo)
                .then(txid => resolve(txid))
                .catch(error => reject(error))
        })
    }

    function deserializeTx(tx) {
        if (typeof tx === 'string' || Array.isArray(tx)) {
            try {
                tx = bitjs.transaction(tx);
            } catch {
                throw "Invalid transaction hex";
            }
        } else if (typeof tx !== 'object' || typeof tx.sign !== 'function')
            throw "Invalid transaction object";
        return tx;
    }

    floBlockchainAPI.signTx = function (tx, privateKey, sighashtype = 1) {
        if (!floCrypto.getFloID(privateKey))
            throw "Invalid Private key";
        //deserialize if needed
        tx = deserializeTx(tx);
        var signedTxHex = tx.sign(privateKey, sighashtype);
        return signedTxHex;
    }

    const checkSigned = floBlockchainAPI.checkSigned = function (tx, bool = true) {
        tx = deserializeTx(tx);
        let n = [];
        for (let i = 0; i < tx.inputs.length; i++) {
            var s = tx.scriptDecode(i);
            if (s['type'] === 'scriptpubkey')
                n.push(s.signed);
            else if (s['type'] === 'multisig') {
                var rs = tx.decodeRedeemScript(s['rs']);
                let x = {
                    s: 0,
                    r: rs['required'],
                    t: rs['pubkeys'].length
                };
                //check input script for signatures
                var script = Array.from(tx.inputs[i].script);
                if (script[0] == 0) { //script with signatures
                    script = tx.parseScript(script);
                    for (var k = 0; k < script.length; k++)
                        if (Array.isArray(script[k]) && script[k][0] == 48) //0x30 DERSequence
                            x.s++;
                }
                //validate counts
                if (x.r > x.t)
                    throw "signaturesRequired is more than publicKeys";
                else if (x.s < x.r)
                    n.push(x);
                else
                    n.push(true);
            }
        }
        return bool ? !(n.filter(x => x !== true).length) : n;
    }

    floBlockchainAPI.checkIfSameTx = function (tx1, tx2) {
        tx1 = deserializeTx(tx1);
        tx2 = deserializeTx(tx2);
        //compare input and output length
        if (tx1.inputs.length !== tx2.inputs.length || tx1.outputs.length !== tx2.outputs.length)
            return false;
        //compare flodata
        if (tx1.floData !== tx2.floData)
            return false
        //compare inputs
        for (let i = 0; i < tx1.inputs.length; i++)
            if (tx1.inputs[i].outpoint.hash !== tx2.inputs[i].outpoint.hash || tx1.inputs[i].outpoint.index !== tx2.inputs[i].outpoint.index)
                return false;
        //compare outputs
        for (let i = 0; i < tx1.outputs.length; i++)
            if (tx1.outputs[i].value !== tx2.outputs[i].value || Crypto.util.bytesToHex(tx1.outputs[i].script) !== Crypto.util.bytesToHex(tx2.outputs[i].script))
                return false;
        return true;
    }

    floBlockchainAPI.transactionID = function (tx) {
        tx = deserializeTx(tx);
        let clone = bitjs.clone(tx);
        let raw_bytes = Crypto.util.hexToBytes(clone.serialize());
        let txid = Crypto.SHA256(Crypto.SHA256(raw_bytes, { asBytes: true }), { asBytes: true }).reverse();
        return Crypto.util.bytesToHex(txid);
    }

    const getTxOutput = (txid, i) => new Promise((resolve, reject) => {
        promisedAPI(`api/tx/${txid}`)
            .then(result => resolve(result.vout[i]))
            .catch(error => reject(error))
    });

    function getOutputAddress(outscript) {
        var bytes, version;
        switch (outscript[0]) {
            case 118: //legacy
                bytes = outscript.slice(3, outscript.length - 2);
                version = bitjs.pub;
                break
            case 169: //multisig
                bytes = outscript.slice(2, outscript.length - 1);
                version = bitjs.multisig;
                break;
            default: return; //unknown
        }
        bytes.unshift(version);
        var hash = Crypto.SHA256(Crypto.SHA256(bytes, { asBytes: true }), { asBytes: true });
        var checksum = hash.slice(0, 4);
        return bitjs.Base58.encode(bytes.concat(checksum));
    }

    floBlockchainAPI.parseTransaction = function (tx) {
        return new Promise((resolve, reject) => {
            tx = deserializeTx(tx);
            let result = {};
            let promises = [];
            //Parse Inputs
            for (let i = 0; i < tx.inputs.length; i++)
                promises.push(getTxOutput(tx.inputs[i].outpoint.hash, tx.inputs[i].outpoint.index));
            Promise.all(promises).then(inputs => {
                result.inputs = inputs.map(inp => Object({
                    address: inp.scriptPubKey.addresses[0],
                    value: parseFloat(inp.value)
                }));
                let signed = checkSigned(tx, false);
                result.inputs.forEach((inp, i) => inp.signed = signed[i]);
                //Parse Outputs
                result.outputs = tx.outputs.map(out => Object({
                    address: getOutputAddress(out.script),
                    value: util.Sat_to_FLO(out.value)
                }))
                //Parse Totals
                result.total_input = parseFloat(result.inputs.reduce((a, inp) => a += inp.value, 0).toFixed(8));
                result.total_output = parseFloat(result.outputs.reduce((a, out) => a += out.value, 0).toFixed(8));
                result.fee = parseFloat((result.total_input - result.total_output).toFixed(8));
                result.floData = tx.floData;
                resolve(result);
            }).catch(error => reject(error))
        })
    }

    //Broadcast signed Tx in blockchain using API
    const broadcastTx = floBlockchainAPI.broadcastTx = function (signedTxHash) {
        return new Promise((resolve, reject) => {
            if (signedTxHash.length < 1)
                return reject("Empty Transaction Data");

            promisedAPI('/api/sendtx/' + signedTxHash)
                .then(response => resolve(response["result"]))
                .catch(error => reject(error))
        })
    }

    const getTx = floBlockchainAPI.getTx = function (txid) {
        return new Promise((resolve, reject) => {
            promisedAPI(`api/tx/${txid}`)
                .then(response => resolve(response))
                .catch(error => reject(error))
        })
    }

    /**Wait for the given txid to get confirmation in blockchain
     * @param  {string} txid of the transaction to wait for
     * @param  {int} max_retry: maximum number of retries before exiting wait. negative number = Infinite retries  (DEFAULT: -1 ie, infinite retries)
     * @param  {Array} retry_timeout: time (seconds) between retries (DEFAULT: 20 seconds)
     * @return {Promise} resolves when tx gets confirmation
     */
    const waitForConfirmation = floBlockchainAPI.waitForConfirmation = function (txid, max_retry = -1, retry_timeout = 20) {
        return new Promise((resolve, reject) => {
            setTimeout(function () {
                getTx(txid).then(tx => {
                    if (!tx)
                        return reject("Transaction not found");
                    if (tx.confirmations)
                        return resolve(tx);
                    else if (max_retry === 0)    //no more retries
                        return reject("Waiting timeout: tx still not confirmed");
                    else {
                        max_retry = max_retry < 0 ? -1 : max_retry - 1; //decrease retry count (unless infinite retries)
                        waitForConfirmation(txid, max_retry, retry_timeout)
                            .then(result => resolve(result))
                            .catch(error => reject(error))
                    }
                }).catch(error => reject(error))
            }, retry_timeout * 1000)
        })
    }

    //Read Txs of Address
    const readTxs = floBlockchainAPI.readTxs = function (addr, options = {}) {
        return new Promise((resolve, reject) => {
            //API options
            let query_params = { details: 'txs' };
            //page options
            if (!isUndefined(options.page) && Number.isInteger(options.page))
                query_params.page = options.page;
            if (!isUndefined(options.pageSize) && Number.isInteger(options.pageSize))
                query_params.pageSize = options.pageSize;
            //only confirmed tx
            if (options.confirmed)  //Default is false in server, so only add confirmed filter if confirmed has a true value
                query_params.confirmed = true;

            promisedAPI(`api/address/${addr}`, query_params).then(response => {
                if (!Array.isArray(response.txs))    //set empty array if address doesnt have any tx
                    response.txs = [];
                resolve(response)
            }).catch(error => reject(error))
        });
    }

    //backward support (floBlockchainAPI < v2.5.6)
    function readAllTxs_oldSupport(addr, options, ignoreOld = 0, cacheTotal = 0) {
        return new Promise((resolve, reject) => {
            readTxs(addr, options).then(response => {
                cacheTotal += response.txs.length;
                let n_remaining = response.txApperances - cacheTotal
                if (n_remaining < ignoreOld) { // must remove tx that would have been fetch during prev call
                    let n_remove = ignoreOld - n_remaining;
                    resolve(response.txs.slice(0, -n_remove));
                } else if (response.page == response.totalPages) //last page reached
                    resolve(response.txs);
                else {
                    options.page = response.page + 1;
                    readAllTxs_oldSupport(addr, options, ignoreOld, cacheTotal)
                        .then(result => resolve(response.txs.concat(result)))
                        .catch(error => reject(error))
                }
            }).catch(error => reject(error))
        })
    }

    function readAllTxs_new(addr, options, lastItem) {
        return new Promise((resolve, reject) => {
            readTxs(addr, options).then(response => {
                let i = response.txs.findIndex(t => t.txid === lastItem);
                if (i != -1)  //found lastItem
                    resolve(response.txs.slice(0, i))
                else if (response.page == response.totalPages) //last page reached
                    resolve(response.txs);
                else {
                    options.page = response.page + 1;
                    readAllTxs_new(addr, options, lastItem)
                        .then(result => resolve(response.txs.concat(result)))
                        .catch(error => reject(error))
                }
            }).catch(error => reject(error))
        })
    }

    //Read All Txs of Address (newest first)
    const readAllTxs = floBlockchainAPI.readAllTxs = function (addr, options = {}) {
        return new Promise((resolve, reject) => {
            if (Number.isInteger(options.ignoreOld)) //backward support: data from floBlockchainAPI < v2.5.6
                readAllTxs_oldSupport(addr, options, options.ignoreOld).then(txs => {
                    let last_tx = txs.find(t => t.confirmations > 0);
                    let new_lastItem = last_tx ? last_tx.txid : options.ignoreOld;
                    resolve({
                        lastItem: new_lastItem,
                        items: txs
                    })

                }).catch(error => reject(error))
            else    //New format for floBlockchainAPI >= v2.5.6
                readAllTxs_new(addr, options, options.after).then(txs => {
                    let last_tx = txs.find(t => t.confirmations > 0);
                    let new_lastItem = last_tx ? last_tx.txid : options.after;
                    resolve({
                        lastItem: new_lastItem,
                        items: txs
                    })
                }).catch(error => reject(error))
        })
    }

    /*Read flo Data from txs of given Address
    options can be used to filter data
    after       : query after the given txid
    confirmed   : query only confirmed tx or not (options same as readAllTx, DEFAULT=true: only_confirmed_tx)
    ignoreOld   : ignore old txs (deprecated: support for backward compatibility only, cannot be used with 'after')
    sentOnly    : filters only sent data
    receivedOnly: filters only received data
    pattern     : filters data that with JSON pattern
    filter      : custom filter funtion for floData (eg . filter: d => {return d[0] == '$'})
    tx          : (boolean) resolve tx data or not (resolves an Array of Object with tx details)
    sender      : flo-id(s) of sender
    receiver    : flo-id(s) of receiver
    */
    floBlockchainAPI.readData = function (addr, options = {}) {
        return new Promise((resolve, reject) => {

            //fetch options
            let query_options = {};
            query_options.confirmed = isUndefined(options.confirmed) ? true : options.confirmed; //DEFAULT: ignore unconfirmed tx

            if (!isUndefined(options.after))
                query_options.after = options.after;
            else if (!isUndefined(options.ignoreOld))
                query_options.ignoreOld = options.ignoreOld;

            readAllTxs(addr, query_options).then(response => {

                if (typeof options.senders === "string") options.senders = [options.senders];
                if (typeof options.receivers === "string") options.receivers = [options.receivers];

                //filter the txs based on options
                const filteredData = response.items.filter(tx => {

                    if (!tx.confirmations)  //unconfirmed transactions: this should not happen as we send mempool=false in API query
                        return false;

                    if (options.sentOnly && !tx.vin.some(vin => vin.addresses[0] === addr))
                        return false;
                    else if (Array.isArray(options.senders) && !tx.vin.some(vin => options.senders.includes(vin.addresses[0])))
                        return false;

                    if (options.receivedOnly && !tx.vout.some(vout => vout.scriptPubKey.addresses[0] === addr))
                        return false;
                    else if (Array.isArray(options.receivers) && !tx.vout.some(vout => options.receivers.includes(vout.scriptPubKey.addresses[0])))
                        return false;

                    if (options.pattern) {
                        try {
                            let jsonContent = JSON.parse(tx.floData);
                            if (!Object.keys(jsonContent).includes(options.pattern))
                                return false;
                        } catch {
                            return false;
                        }
                    }

                    if (options.filter && !options.filter(tx.floData))
                        return false;

                    return true;
                }).map(tx => options.tx ? {
                    txid: tx.txid,
                    time: tx.time,
                    blockheight: tx.blockheight,
                    senders: new Set(tx.vin.map(v => v.addresses[0])),
                    receivers: new Set(tx.vout.map(v => v.scriptPubKey.addresses[0])),
                    data: tx.floData
                } : tx.floData);

                const result = { lastItem: response.lastItem };
                if (options.tx)
                    result.items = filteredData;
                else
                    result.data = filteredData
                resolve(result);

            }).catch(error => reject(error))
        })
    }

    /*Get the latest flo Data that match the caseFn from txs of given Address
    caseFn: (function) flodata => return bool value
    options can be used to filter data
    after       : query after the given txid
    confirmed   : query only confirmed tx or not (options same as readAllTx, DEFAULT=true: only_confirmed_tx)
    sentOnly    : filters only sent data
    receivedOnly: filters only received data
    tx          : (boolean) resolve tx data or not (resolves an Array of Object with tx details)
    sender      : flo-id(s) of sender
    receiver    : flo-id(s) of receiver
    */
    const getLatestData = floBlockchainAPI.getLatestData = function (addr, caseFn, options = {}) {
        return new Promise((resolve, reject) => {
            //fetch options
            let query_options = {};
            query_options.confirmed = isUndefined(options.confirmed) ? true : options.confirmed; //DEFAULT: confirmed tx only
            if (!isUndefined(options.page))
                query_options.page = options.page;
            //if (!isUndefined(options.after)) query_options.after = options.after;

            let new_lastItem;
            readTxs(addr, query_options).then(response => {

                //lastItem confirmed tx checked
                if (!new_lastItem) {
                    let last_tx = response.items.find(t => t.confirmations > 0);
                    if (last_tx)
                        new_lastItem = last_tx.txid;
                }

                if (typeof options.senders === "string") options.senders = [options.senders];
                if (typeof options.receivers === "string") options.receivers = [options.receivers];

                //check if `after` txid is in the response
                let i_after = response.txs.findIndex(t => t.txid === options.after);
                if (i_after != -1)  //found lastItem, hence remove it and all txs before that
                    response.items.splice(i_after);

                var item = response.items.find(tx => {
                    if (!tx.confirmations)  //unconfirmed transactions: this should not happen as we send mempool=false in API query
                        return false;

                    if (options.sentOnly && !tx.vin.some(vin => vin.addresses[0] === addr))
                        return false;
                    else if (Array.isArray(options.senders) && !tx.vin.some(vin => options.senders.includes(vin.addresses[0])))
                        return false;

                    if (options.receivedOnly && !tx.vout.some(vout => vout.scriptPubKey.addresses[0] === addr))
                        return false;
                    else if (Array.isArray(options.receivers) && !tx.vout.some(vout => options.receivers.includes(vout.scriptPubKey.addresses[0])))
                        return false;

                    return caseFn(tx.floData) ? true : false;   //return only bool for find fn
                });

                //if item found, then resolve the result
                if (!isUndefined(item)) {
                    const result = { lastItem: new_lastItem || item.txid };
                    if (options.tx) {
                        result.item = {
                            txid: item.txid,
                            time: item.time,
                            blockheight: item.blockheight,
                            senders: new Set(item.vin.map(v => v.addresses[0])),
                            receivers: new Set(item.vout.map(v => v.scriptPubKey.addresses[0])),
                            data: item.floData
                        }
                    } else
                        result.data = item.floData;
                    return resolve(result);
                }

                if (response.page == response.totalPages || i_after != -1) //reached last page to check 
                    resolve({ lastItem: new_lastItem || options.after }); //no data match the caseFn, resolve just the lastItem

                //else if address needs chain query
                else {
                    options.page = response.page + 1;
                    getLatestData(addr, caseFn, options)
                        .then(result => resolve(result))
                        .catch(error => reject(error))
                }

            }).catch(error => reject(error))
        })
    }

})('object' === typeof module ? module.exports : window.floBlockchainAPI = {});