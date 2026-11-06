import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import request from 'supertest';
import { app, server } from '../src/index.js';
import { db } from '../src/db.js';
import { signToken } from '../src/auth.js';

describe('Real-time Socket.IO Layer Tests', () => {
  let port;
  let serverUrl;
  let tl1, tc1, tlToken;

  before(async () => {
    tl1 = db.prepare("SELECT * FROM users WHERE employee_code = 'TL001'").get();
    tc1 = db.prepare("SELECT * FROM users WHERE tl_id = ? AND role = 'telecaller'").get(tl1.id);
    tlToken = signToken(tl1);

    if (!server.listening) {
      await new Promise((resolve) => server.listen(0, resolve));
    }
    port = server.address().port;
    serverUrl = `http://localhost:${port}`;
  });

  after(() => {
    server.close();
  });

  test('Reject connection with wrong TV key or invalid token', async () => {
    await new Promise((resolve, reject) => {
      const socket = Client(serverUrl, {
        auth: { tvKey: 'wrong_key' },
        transports: ['websocket'],
        reconnection: false,
      });

      socket.on('connect', () => {
        socket.close();
        reject(new Error('Should not have connected with wrong key'));
      });

      socket.on('connect_error', (err) => {
        assert.match(err.message, /unauthorized/i);
        socket.close();
        resolve();
      });
    });
  });

  test('Connect successfully with valid TV key, receive snapshot and event:new', async () => {
    const validKey = process.env.TV_KEY;
    assert.ok(validKey, 'TV_KEY should be set');

    await new Promise((resolve, reject) => {
      const socket = Client(serverUrl, {
        auth: { tvKey: validKey },
        transports: ['websocket'],
        reconnection: false,
      });

      let gotSnapshot = false;

      socket.on('connect_error', (err) => {
        socket.close();
        reject(err);
      });

      socket.on('snapshot', (data) => {
        assert.ok(data.totals);
        assert.ok(Array.isArray(data.programs));
        gotSnapshot = true;
      });

      socket.on('connect', async () => {
        // Trigger an event via REST API to verify event:new broadcast
        const res = await request(app)
          .post('/api/events')
          .set('Authorization', `Bearer ${tlToken}`)
          .send({ telecaller_id: tc1.id, status_code: 'sale_closed', confirm_duplicate: true });
        assert.equal(res.status, 201);
      });

      socket.on('event:new', (ev) => {
        assert.equal(ev.telecaller.id, tc1.id);
        assert.equal(ev.status.code, 'sale_closed');
        assert.ok(gotSnapshot, 'Should have received initial snapshot');
        socket.close();
        resolve();
      });
    });
  });
});
