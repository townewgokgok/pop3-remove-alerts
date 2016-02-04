'use strict';

var fs = require('fs');
var path = require('path');
var yaml = require('js-yaml');
var config = yaml.safeLoad(fs.readFileSync(path.resolve(__dirname, 'config.yml'), 'utf8'));
var POP3Client = require('poplib');
var MailParser = require("mailparser").MailParser;
var ansi = require('ansi');
var cursor = ansi(process.stdout);



function ruleToDelete(headers) {
    return
        headers.from.match(/^apache\@/) &&
        headers.subject.match(/(mongo exception|service unavailable)/);
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
    current = 0;
    total = msgcount;
    processNext();
});

function processNext() {
    if (++current <= total) {
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
    if (ruleToDelete(obj.headers)) {
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
