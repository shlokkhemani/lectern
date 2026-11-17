---
title: sequence fixture
---

# Handshake
## Three messages, two starting numbers
::: sequence open "client and server, time flows down"
Client | Server
Server: LISTEN
Client -> Server: SYN · seq 1000  #syn
Client: SYN-SENT
Server: SYN-RECEIVED
Server -> Client: SYN-ACK · seq 5000 · ack 1001  #synack
Client: ESTABLISHED
Client -> Server: ACK · seq 1001 · ack 5001  #ack
Server: ESTABLISHED
:::
[show hl syn] The client sends a SYN. [show hl synack] The server answers. [show hl ack] The client confirms, [set open:server.3 OPEN] and the server opens.

## Lost and stale
::: sequence three
Client | Server
Client: SYN-SENT · 1000
Server: LISTEN
Client --> Server: {bad old SYN} · seq 700  #old
Server: SYN-RECEIVED
Server -> Client: SYN-ACK · seq 5000 · ack 701  #reply
Client: expected 1001
Client -> Server: RST · seq 701  #rst
Server: LISTEN
Client -x Server: SYN · seq 1000  #lost
Client: timeout
Client -> Server: SYN · seq 1000  #fresh
:::
[show three:old] An old SYN arrives. [show hl reply] The server replies. [show hl rst] The client resets, [show three:lost] its own SYN is lost, [show hl fresh] and it tries again.

## Three parties
::: sequence auth "sign in with a provider"
Browser | App | Provider
Browser -> App: GET /login
App -> Browser: redirect
Browser -> Provider: sign in
Provider: checks password
Provider -> Browser: code
Browser -> App: code
App -> Provider: code + secret
Provider -> App: token
App: session
:::
[grow auth] The browser asks the app, is sent to the provider, [hl auth:7] and the app trades the code for a token.
