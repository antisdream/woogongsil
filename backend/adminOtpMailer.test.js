'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('sensitive OTP mail uses finite SMTP timeouts and never logs mail results or failures', async t => {
    const nodemailer = require('nodemailer');
    const oldUser = process.env.MAIL_USER, oldPass = process.env.MAIL_APP_PASSWORD;
    process.env.MAIL_USER = 'sender@example.test'; process.env.MAIL_APP_PASSWORD = 'synthetic-only';
    t.after(() => {
        if (oldUser === undefined) delete process.env.MAIL_USER; else process.env.MAIL_USER = oldUser;
        if (oldPass === undefined) delete process.env.MAIL_APP_PASSWORD; else process.env.MAIL_APP_PASSWORD = oldPass;
        delete require.cache[require.resolve('./mailer')];
    });
    let config, fail = false;
    t.mock.method(nodemailer, 'createTransport', options => {
        config = options;
        return { sendMail: async () => { if (fail) throw new Error('synthetic mail failure'); return { messageId: 'synthetic-id' }; } };
    });
    const log = t.mock.method(console, 'log', () => {});
    const error = t.mock.method(console, 'error', () => {});
    delete require.cache[require.resolve('./mailer')];
    const { sendEmail } = require('./mailer');
    assert.equal((await sendEmail('admin@example.test', 'test', 'synthetic code', { sensitive: true })).success, true);
    assert.equal(config.secure, true);
    for (const name of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) assert.ok(config[name] > 0 && config[name] <= 15000);
    fail = true;
    assert.equal((await sendEmail('admin@example.test', 'test', 'synthetic code', { sensitive: true })).success, false);
    assert.equal(log.mock.callCount(), 0); assert.equal(error.mock.callCount(), 0);
});
