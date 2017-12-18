//Get current prices and update matching holdings by ticker. Ex: 'bitcoin' === 'BITCOIN'
function setPrices(holdings, callback) {
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (this.readyState === 4) {
            var fixed = [];
            var data = JSON.parse(this.responseText);
            holdings.forEach(function(h) {
                var found = false;
                data.forEach(function(c) {
                    //Trim any special characters
                    if (h.ticker && h.ticker.toLowerCase().match(/[a-z-]+/g)[0] === c.id) {
                        h.price = +c.price_usd;
                        fixed.push(h);
                        found = true;
                    }    
                });
                // Push original in order to get erc20 balance updates
                if (!found && h.description && h.description.toLowerCase().slice(0, 8) === "erc20:0x") {
                    fixed.push(h);
                }
            });
            callback(fixed);
        }
    };
    //Get all coins
    xhr.open("GET", "https://api.coinmarketcap.com/v1/ticker/?limit=0")
    xhr.send();
}

//Retreive all securities from personal capital that were added manually
function getHoldings(csrf, callback) {
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (this.readyState === 4) {
            var holdings = [];
            var data = JSON.parse(this.responseText);
            data.spData.holdings.forEach(function(c) {
                if (c.source === 'USER') {
                    holdings.push(c);
                }
            });
            callback(holdings);
        }
    };
    xhr.open("POST", "https://home.personalcapital.com/api/invest/getHoldings");
    var formdata = new FormData();
    formdata.append('csrf', csrf);
    formdata.append('apiClient', 'WEB');
    xhr.send(formdata);
}

//update a security with new data on behalf of the user
function updateHolding(csrf, data) {
    return new Promise(function(resolve, reject) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function() {
                if (this.readyState === 4) {
                    if (this.status === 200) {
                        resolve();
                    } else {
                        reject(this.statusText);
                    }
                }
            };
            xhr.open("POST", "https://home.personalcapital.com/api/account/updateHolding");
            var formdata = new FormData();
            formdata.append('csrf', csrf);
            formdata.append('apiClient', 'WEB');
            for (var key in data) {
                formdata.append(key, data[key]);
            }
            xhr.send(formdata);
        } catch (err) {
            reject(err);
        }
    });
}

function getHTML(url) {
    return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (this.readyState === 4) {
                if (this.status === 200) {
                    resolve(this.responseText);
                } else {
                    reject(this.statusText);
                }
            }
        };
        xhr.open("GET", url);
        xhr.send();
    });
}

function getJSON(url) {
    return getHTML(url).then(function(html) {
        return JSON.parse(html);
    });
}

function getBlockcypherBalance(url) {
    return getJSON(url).then(function(data) {
        if (data.balance) {
            return data.balance;
        } else {
            throw "Invalid json response";
        }
    });
}

function updateBlockcypherBalancePromise(account, symbol, smallestUnit) {
    return new Promise(function(resolve, reject) {
        var balanceUrl = 'https://api.blockcypher.com/v1/' + symbol + '/main/addrs/' + account.description + '/balance';
        getBlockcypherBalance(balanceUrl).then(function(balance) {
            account.quantity = balance * smallestUnit;
            console.log('Resolved ' + account.ticker + ' account balance for address ' + account.description + ' as: ' + account.quantity);
            resolve();
        }, function(err) {
            console.log('Error retreiving ' + account.ticker + ' account balance for address ' + account.description + '. Error: ' + err);
            resolve();
        });
    });
}

function updateXpubBalancePromise(account, symbol, smallestUnit) {
    var balanceUrl = 'https://blockchain.info/xpub/' + account.description;
    return getHTML(balanceUrl).then(function(html) {
        html = html.match(/id="final_balance">[^0-9.]+\d+[^0-9.]+([^ ]+)/);
        if (!html) {
            throw "";
        }
        account.quantity = parseFloat(html[1]);
        console.log('Resolved ' + account.ticker + ' account balance for address ' + account.description + ' as: ' + account.quantity);
    }).catch(function(err) {
        console.log('Error retreiving ' + account.ticker + ' account balance for address ' + account.description + '. Error: ' + err);
        return 0;
    });
}

var erc20Dictionary = {};
function getErc20BalancePromise(account, symbol) {
    var ethereumAddress = account.description.slice(6);
    return new Promise(function(resolve, reject) {
        if (erc20Dictionary[ethereumAddress]) {
            resolve(erc20Dictionary[ethereumAddress]);
        }
        reject();
    }).catch(function() {
        var balanceUrl = 'https://api.ethplorer.io/getAddressInfo/' + ethereumAddress + '?apiKey=freekey';
        return getJSON(balanceUrl);
    }).then(function(data) {
        erc20Dictionary[ethereumAddress] = data;
        var token = data.tokens.find(function(token) {
            return token.tokenInfo.name.toLowerCase() == symbol || token.tokenInfo.symbol.toLowerCase() == symbol;
        });
        if (!token) {
            throw "";
        }
        var balance = token.balance / Math.pow(10, token.tokenInfo.decimals);
        account.quantity = balance || 0;
        console.log('Resolved ' + account.ticker + ' account balance for address ' + ethereumAddress + ' as: ' + account.quantity);
    }).catch(function(err) {
        console.log('Error retreiving ' + account.ticker + ' account balance for address ' + ethereumAddress + '. Error: ' + err);
        return 0;
    });
}

function getAddressBalances(accountList, callback) {
    accountList.reduce(function(lastPromise, account) {
        return lastPromise.then(function(result) {
            if (account.description && account.ticker) {
                switch (account.ticker.toLowerCase().match(/[a-z-]+/g)[0]) {
                    case 'bitcoin':
                        return account.description.slice(0,4) === "xpub"
                            ? updateXpubBalancePromise(account)
                            : updateBlockcypherBalancePromise(account, 'btc', 1e-8); // 10^8 satoshis/btc
                    case 'litecoin':
                        return updateBlockcypherBalancePromise(account, 'ltc', 1e-8); // 10^8 base units/ltc
                    case 'dogecoin':
                        return updateBlockcypherBalancePromise(account, 'doge', 1e-8); // 10^8 koinus/dogecoin
                    case 'ethereum':
                        return updateBlockcypherBalancePromise(account, 'eth', 1e-18); // 10^18 wei/eth
                }
                if (account.description.toLowerCase().slice(0, 8) === "erc20:0x") {
                    return getErc20BalancePromise(account, account.ticker.toLowerCase().match(/[a-z-]+/g)[0]);
                }
            }
            //No description, no wallet address
            return Promise.resolve();
        });
    }, Promise.resolve()).then(function(result) {
        console.log('Done resolving account balances');
        callback(accountList);
    });
}

//When page is loaded:
//1. get all holdings from personalcapital API
//2. set updated prices for each holding that the ticker matches from coinmarketcap API
//3. update new price for each holding with personalcapital API
window.addEventListener("message", function(event) {
    if (event.source === window && event.data.type && (event.data.type == "PFCRYPTO_CSRF")) {
        var csrf = event.data.text;
        getHoldings(csrf, function(holdings) {
            setPrices(holdings, function(fixed) {
                getAddressBalances(fixed, function(final) {
                    final.reduce(function(p, h) {
                        return p.then(function(result) {
                            return updateHolding(csrf, h).then(function(result) {
                                console.log('success updating ' + h.ticker + ' to ' + h.price);
                            }).catch(function(reason) {
                                console.log('ERROR updating ' + h.ticker + ' to ' + h.price + ': ' + reason);
                            });
                        });
                    }, Promise.resolve()).then(function(result) {
                        console.log('done updating holdings.');
                    });
                });
            });
        });
    }
}, false);

//Hacky way to retrieve user session variable from content script
var s = document.createElement('script');
s.setAttribute('type', 'text/javascript');
s.innerHTML = `window.postMessage({
    "type": "PFCRYPTO_CSRF",
    text: window.csrf
}, "*");`
document.body.appendChild(s);
