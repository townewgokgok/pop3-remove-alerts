'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const config = yaml.safeLoad(
    fs.readFileSync(path.resolve(__dirname, 'config.yml'), 'utf8'),
    { schema: yaml.DEFAULT_FULL_SCHEMA }
);
const POP3Client = require('poplib');
const MailParser = require('mailparser').MailParser;
const moment = require('moment');
const ansi = require('ansi');
const cursor = ansi(process.stdout);


if (!config.deleteRule || Object.keys(config.deleteRule).length == 0) {
    throw '"deleteRule:" is not defined in config.yml';
}
const deleteBefore = moment(config.deleteBefore);

function matches(headers) {
    if (moment(headers.date).isBefore(deleteBefore)) return true;
    let result = true;
    Object.keys(config.deleteRule).forEach(function(key){
        let v = headers[key]
        if (v == null || !v.match(config.deleteRule[key])) {
            result = false;
        }
    });
    return result;
}



function main(session, skip) {

    const direction = config.des ? -1 : 1;
    let current = 0;
    let total = 0;
    let marked = 0;
    let quitting = false;

    console.log(`#${session} connecting...`);
    const client = new POP3Client(config.port, config.host, {
        tlserrs: false,
        enabletls: false,
        debug: false
    });

    function reconnect() {
        console.log('');
        console.log(`#${session} quitting...`);
        quitting = true;
        client.on('quit', function() {
            setTimeout(function(){
                main(session+1, skip);
            }, 1000);
        });
        client.quit();
    }

    let timer;
    function stamp(quit) {
        if (timer) clearTimeout(timer);
        if (!quit) timer = setTimeout(reconnect, config.timeout);
    }
    stamp();

    client.on('connect', function() {
        if (quitting) return;
        stamp();
        console.log(`#${session} CONNECT success`);
        client.login(config.user, config.pass);
    });

    client.on('login', function(status, rawdata) {
        if (quitting) return;
        stamp();
        if (!status) {
            console.log(`#${session} LOGIN/PASS failed`);
            reconnect();
            return;
        }
        console.log(`#${session} LOGIN/PASS success`);
        client.list();
    });

    client.on('list', function(status, msgcount, msgnumber, data, rawdata) {
        if (quitting) return;
        stamp();
        if (!status) {
            console.log(`#${session} LIST failed`);
            reconnect();
            return;
        }
        console.log(`#${session} LIST success with ${msgcount} element(s)`);
        if (msgcount == 0) {
            client.quit();
            stamp(true);
            process.exit();
            return;
        }
        current = 0<direction ? 0 : msgcount+1;
        current += direction * skip;
        total = msgcount;
        processNext();
    });

    function processNext() {
        current += direction;
        if (current < 1 || total < current) {
            console.log('');
            console.log(`#${session} finished`);
            client.quit();
            stamp(true);
            process.exit();
            return;
        }
        if (config.step <= marked) {
            reconnect();
            return;
        }
        client.top(current, 0);
    }

    function onDecode(obj) {
        if (matches(obj.headers)) {
            client.dele(current);
        } else {
            cursor.eraseLine();
            console.log(obj.headers.from+" : "+obj.subject);
            skip++;
            processNext();
        }
        console.log(`#${session}   ${current} / ${total} (marked ${marked}, skipped ${current-marked}}})`);
        cursor.up();
    }

    client.on('dele', function(status, msgnumber, rawdata) {
        if (quitting) return;
        stamp();
        if (!status) {
            cursor.eraseLine();
            console.log(`#${session} DELE ${current} / ${total} failed`);
            reconnect();
            return;
        }
        marked++;
        processNext();
    });

    client.on('top', function(status, msgnumber, data, rawdata) {
        if (quitting) return;
        stamp();
        if (!status) {
            cursor.eraseLine();
            console.log(`#${session} TOP ${current} / ${total} failed`);
            reconnect();
            return;
        }
        const parser = new MailParser();
        parser.on('end', onDecode);
        parser.write(data);
        parser.end();
    });

}

main(1, config.skip);
