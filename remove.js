'use strict';

var fs = require('fs');
var path = require('path');
var yaml = require('js-yaml');
var config = yaml.safeLoad(
    fs.readFileSync(path.resolve(__dirname, 'config.yml'), 'utf8'),
    { schema: yaml.DEFAULT_FULL_SCHEMA }
);
var POP3Client = require('poplib');
var MailParser = require('mailparser').MailParser;
var moment = require('moment');
var ansi = require('ansi');
var cursor = ansi(process.stdout);


if (!config.deleteRule || Object.keys(config.deleteRule).length == 0) {
    throw '"deleteRule:" is not defined in config.yml';
}
var deleteBefore = moment(config.deleteBefore);

function matches(headers) {
    if (moment(headers.date).isBefore(deleteBefore)) return true;
    var result = true;
    Object.keys(config.deleteRule).forEach(function(key){
        if (headers[key] == null || !headers[key].match(config.deleteRule[key])) {
            result = false;
        }
    });
    return result;
}



var client = new POP3Client(config.port, config.host, {
    tlserrs: false,
    enabletls: false,
    debug: false
});

client.on('connect', function() {
    console.log('CONNECT success');
    client.login(config.user, config.pass);
});

client.on('login', function(status, rawdata) {
    if (!status) {
        console.log('LOGIN/PASS failed');
        client.quit();
        return;
    }
    console.log('LOGIN/PASS success');
    client.list();
});

var current = 0;
var direction = config.desc ? -1 : 1;
var total = 0;
var deleted = 0;

client.on('list', function(status, msgcount, msgnumber, data, rawdata) {
    if (!status) {
        console.log('LIST failed');
        client.quit();
        process.exit(1);
        return;
    }
    console.log('LIST success with ' + msgcount + ' element(s)');
    if (msgcount == 0) {
        client.quit();
        process.exit();
        return;
    }
    current = 0<direction ? 0 : msgcount+1;
    total = msgcount;
    processNext();
});

function processNext() {
    current += direction;
    if (1<= current && current <= total) {
        client.top(current, 0);
    }
    else {
        console.log('');
        console.log('finished');
        client.quit();
        process.exit();
    }
}

function onDecode(obj) {
    if (matches(obj.headers)) {
        client.dele(current);
    }
    else {
        processNext();
    }
    console.log('  ' + current + ' / ' + total + ' (deleted ' + deleted + ')');
    cursor.up();
}

client.on('dele', function(status, msgnumber, rawdata) {
    if (status) {
        deleted++;
    }
    else {
        cursor.eraseLine();
        console.log('DELE ' + current + ' / ' + total + ' failed');
    }
    processNext();
});

client.on('top', function(status, msgnumber, data, rawdata) {
    if (!status) {
        cursor.eraseLine();
        console.log('TOP ' + current + ' / ' + total + ' failed');
        processNext();
        return;
    }
    var parser = new MailParser();
    parser.on('end', onDecode);
    parser.write(data);
    parser.end();
});
