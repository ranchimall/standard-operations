(function (EXPORTS) { //floTokenAPI v1.1.0a
    /* Token Operator to send/receive tokens via blockchain using API calls*/
    'use strict';
    const tokenAPI = EXPORTS;

    const DEFAULT = {
        apiURL: [floGlobals.tokenURL || "https://ranchimallflo.ranchimall.net/"],
        currency: floGlobals.currency || "rupee"
    }


    const checkIfTor = tokenAPI.checkIfTor = () => {
        return fetch('https://check.torproject.org/api/ip', {
            mode: 'no-cors'
        })
            .then(response => response.json())
            .then(result => result.IsTor)
            .catch(error => false)
    }
    let isTor = false;
    checkIfTor().then(result => {
        isTor = result
        if (isTor) {
            DEFAULT.apiURL.push('http://omwkzk6bd6zuragdqsrhdyzgxzre7yx4vzrou4vzftintzc2dmagp6qd.onion:5017/')
        }
    });

    Object.defineProperties(tokenAPI, {
        URL: {
            get: () => DEFAULT.apiURL[0],
        },
        currency: {
            get: () => DEFAULT.currency,
            set: currency => DEFAULT.currency = currency
        }
    });

    if (floGlobals.currency) tokenAPI.currency = floGlobals.currency;

    Object.defineProperties(floGlobals, {
        currency: {
            get: () => DEFAULT.currency,
            set: currency => DEFAULT.currency = currency
        }
    });

    const fetch_api = tokenAPI.fetch = function (apicall, apiURLs = DEFAULT.apiURL) {
        return new Promise((resolve, reject) => {
            if (apiURLs.length === 0) {
                reject("No API URLs available");
                return;
            }
            const currentURL = apiURLs[0];
            console.debug(currentURL + apicall);
            fetch(currentURL + apicall).then(response => {
                if (response.ok)
                    response.json().then(data => resolve(data));
                else
                    reject(response);
            }).catch(error => {
                console.error(`Failed to fetch from ${currentURL}: ${error}`);
                // Try the next API URL recursively
                fetch_api(apicall, apiURLs.slice(1)).then(resolve).catch(reject);
            });
        });
    }

    const getBalance = tokenAPI.getBalance = function (floID, token = DEFAULT.currency) {
        return new Promise((resolve, reject) => {
            fetch_api(`api/v2/floAddressInfo/${floID}`)
                .then(result => resolve(result.floAddressBalances[token]?.balance || 0))
                .catch(error => reject(error))
        })
    }

    tokenAPI.getTx = function (txID) {
        return new Promise((resolve, reject) => {
            fetch_api(`api/v2/transactionDetails/${txID}`).then(res => {
                if (res.result === "error")
                    reject(res.description);
                else if (!res.parsedFloData)
                    reject("Data piece (parsedFloData) missing");
                else if (!res.transactionDetails)
                    reject("Data piece (transactionDetails) missing");
                else
                    resolve(res);
            }).catch(error => reject(error))
        })
    }

    tokenAPI.sendToken = function (privKey, amount, receiverID, message = "", token = DEFAULT.currency, options = {}) {
        return new Promise((resolve, reject) => {
            let senderID = floCrypto.getFloID(privKey);
            if (typeof amount !== "number" || isNaN(amount) || amount <= 0)
                return reject("Invalid amount");
            getBalance(senderID, token).then(bal => {
                if (amount > bal)
                    return reject(`Insufficient ${token}# balance`);
                floBlockchainAPI.writeData(senderID, `send ${amount} ${token}# ${message}`, privKey, receiverID, options)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        });
    }

    function sendTokens_raw(privKey, receiverID, token, amount, utxo, vout, scriptPubKey) {
        return new Promise((resolve, reject) => {
            var trx = bitjs.transaction();
            trx.addinput(utxo, vout, scriptPubKey)
            trx.addoutput(receiverID, floBlockchainAPI.sendAmt);
            trx.addflodata(`send ${amount} ${token}#`);
            var signedTxHash = trx.sign(privKey, 1);
            floBlockchainAPI.broadcastTx(signedTxHash)
                .then(txid => resolve([receiverID, txid]))
                .catch(error => reject([receiverID, error]))
        })
    }

    //bulk transfer tokens
    tokenAPI.bulkTransferTokens = function (sender, privKey, token, receivers) {
        return new Promise((resolve, reject) => {
            if (typeof receivers !== 'object')
                return reject("receivers must be object in format {receiver1: amount1, receiver2:amount2...}")

            let receiver_list = Object.keys(receivers), amount_list = Object.values(receivers);
            let invalidReceivers = receiver_list.filter(id => !floCrypto.validateFloID(id));
            let invalidAmount = amount_list.filter(val => typeof val !== 'number' || val <= 0);
            if (invalidReceivers.length)
                return reject(`Invalid receivers: ${invalidReceivers}`);
            else if (invalidAmount.length)
                return reject(`Invalid amounts: ${invalidAmount}`);

            if (receiver_list.length == 0)
                return reject("Receivers cannot be empty");

            if (receiver_list.length == 1) {
                let receiver = receiver_list[0], amount = amount_list[0];
                floTokenAPI.sendToken(privKey, amount, receiver, "", token)
                    .then(txid => resolve({ success: { [receiver]: txid } }))
                    .catch(error => reject(error))
            } else {
                //check for token balance
                floTokenAPI.getBalance(sender, token).then(token_balance => {
                    let total_token_amout = amount_list.reduce((a, e) => a + e, 0);
                    if (total_token_amout > token_balance)
                        return reject(`Insufficient ${token}# balance`);

                    //split utxos
                    floBlockchainAPI.splitUTXOs(sender, privKey, receiver_list.length).then(split_txid => {
                        //wait for the split utxo to get confirmation
                        floBlockchainAPI.waitForConfirmation(split_txid).then(split_tx => {
                            //send tokens using the split-utxo
                            var scriptPubKey = split_tx.vout[0].scriptPubKey.hex;
                            let promises = [];
                            for (let i in receiver_list)
                                promises.push(sendTokens_raw(privKey, receiver_list[i], token, amount_list[i], split_txid, i, scriptPubKey));
                            Promise.allSettled(promises).then(results => {
                                let success = Object.fromEntries(results.filter(r => r.status == 'fulfilled').map(r => r.value));
                                let failed = Object.fromEntries(results.filter(r => r.status == 'rejected').map(r => r.reason));
                                resolve({ success, failed });
                            })
                        }).catch(error => reject(error))
                    }).catch(error => reject(error))
                }).catch(error => reject(error))
            }

        })
    }

    tokenAPI.getAllTxs = function (floID, token = DEFAULT.currency) {
        return new Promise((resolve, reject) => {
            fetch_api(`api/v2/floAddressTransactions/${floID}${token ? `?token=${token}` : ''}`)
                .then(result => resolve(result))
                .catch(error => reject(error))
        })
    }

    const util = tokenAPI.util = {};

    util.parseTxData = function (txData) {
        let parsedData = {};
        for (let p in txData.parsedFloData)
            parsedData[p] = txData.parsedFloData[p];
        parsedData.sender = txData.transactionDetails.vin[0].addr;
        for (let vout of txData.transactionDetails.vout)
            if (vout.scriptPubKey.addresses[0] !== parsedData.sender)
                parsedData.receiver = vout.scriptPubKey.addresses[0];
        parsedData.time = txData.transactionDetails.time;
        return parsedData;
    }

})('object' === typeof module ? module.exports : window.floTokenAPI = {});