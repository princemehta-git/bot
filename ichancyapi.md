# Agent API Documentation (2026)

## Overview

This document describes authentication, authorization, and all Agent and Player endpoints.

**Base URL:**

```
https://agents.ichancy.com/global/api
```

---

# Authentication

## Key Rules

* Only **one accessToken + refreshToken pair** is valid per agent.
* **Access Token TTL:** 1 hour
* **Refresh Token TTL:** 7 days
* **Refresh Token Rotation:** After refresh, old refresh token becomes invalid.
* Duplicate signIn invalidates previous tokens.

---

# Authentication Endpoints

## 1. Sign In

**Endpoint**

```
POST /User/signIn
```

**Request Body**

```json
{
  "username": "YOUR_AGENT_EMAIL",
  "password": "YOUR_AGENT_PASSWORD"
}
```

**Success Response (200)**

```json
{
  "status": true,
  "html": "",
  "result": {
    "accessToken": "ACCESS_TOKEN",
    "refreshToken": "REFRESH_TOKEN"
  },
  "notification": []
}
```

**Error Response (201 Unauthorized)**

```json
{
  "status": true,
  "result": false,
  "notification": [
    {
      "content": "Invalid username or password.",
      "status": "error"
    }
  ]
}
```

---

## 2. Refresh Token

**Endpoint**

```
POST /UserApi/refreshToken
```

**Request Body**

```json
{
  "refreshToken": "YOUR_REFRESH_TOKEN"
}
```

**Success Response**

```json
{
  "status": true,
  "result": {
    "accessToken": "NEW_ACCESS_TOKEN",
    "refreshToken": "NEW_REFRESH_TOKEN"
  }
}
```

**Error Response**

```json
{
  "status": true,
  "result": [],
  "notification": [
    {
      "content": "Invalid or expired refresh token"
    }
  ]
}
```

---

# Agent Endpoints

---

## 3. Get Agent Wallets

**Endpoint**

```
POST /UserApi/getAgentAllWallets
```

**Request Body**

```json
{}
```

**Response**

```json
{
  "status": true,
  "result": [
    {
      "currencyName": "New Syrian Pound",
      "currencyCode": "NSP",
      "balance": "BALANCE",
      "availableWallet": "###",
      "creditLine": "###",
      "availability": "###"
    }
  ]
}
```

---

## 4. Deposit To Agent

**Endpoint**

```
POST /UserApi/depositToAgent
```

**Request Body**

```json
{
  "amount": 100,
  "comment": "optional",
  "affiliateId": "AGENT_ID",
  "moneyStatus": 3,
  "currencyCode": "NSP"
}
```

**Success Response**

```json
{
  "status": true,
  "result": true
}
```

**Error Example**

```json
{
  "status": true,
  "result": false,
  "notification": [
    {
      "content": "Insufficient balance"
    }
  ]
}
```

---

## 5. Withdraw From Agent

**Endpoint**

```
POST /UserApi/withdrawFromAgent
```

**Request Body**

```json
{
  "amount": -100,
  "comment": "optional",
  "affiliateId": "AGENT_ID",
  "moneyStatus": 3,
  "currencyCode": "NSP"
}
```

---

## 6. Get Children Agents

**Endpoint**

```
POST /UserApi/getChildren
```

**Request Body**

```json
{
  "start": 0,
  "limit": 20,
  "filter": {
    "affiliateId": {
      "action": "=",
      "value": "AGENT_ID"
    }
  }
}
```

**Response**

```json
{
  "status": true,
  "result": {
    "records": [
      {
        "affiliateId": "ID",
        "username": "USERNAME",
        "email": "EMAIL"
      }
    ]
  }
}
```

---

# Player Endpoints

---

## 7. Register Player

**Endpoint**

```
POST /UserApi/registerPlayer
```

**Request Body**

```json
{
  "player": {
    "email": "email@example.com",
    "password": "password",
    "parentId": "AGENT_ID",
    "login": "username"
  }
}
```

---

## 8. Get Players

**Endpoint**

```
POST /UserApi/getPlayersForCurrentAgent
```

**Request Body**

```json
{
  "start": 0,
  "limit": 20,
  "filter": {
    "playerId": {
      "action": "=",
      "value": "PLAYER_ID"
    }
  }
}
```

---

## 9. Deposit To Player

**Endpoint**

```
POST /UserApi/depositToPlayer
```

**Request Body**

```json
{
  "amount": 100,
  "comment": "optional",
  "playerId": "PLAYER_ID",
  "currencyCode": "NSP",
  "currency": "NSP",
  "moneyStatus": 5
}
```

---

## 10. Withdraw From Player

**Endpoint**

```
POST /UserApi/withdrawFromPlayer
```

**Request Body**

```json
{
  "amount": -100,
  "comment": "optional",
  "playerId": "PLAYER_ID",
  "currencyCode": "NSP",
  "currency": "NSP",
  "moneyStatus": 5
}
```

---

## 11. Get Player Balance

**Endpoint**

```
POST /UserApi/getPlayerBalanceById
```

**Request Body**

```json
{
  "playerId": "PLAYER_ID"
}
```

**Response**

```json
{
  "status": true,
  "result": [
    {
      "balance": 0,
      "currencyCode": "NSP"
    }
  ]
}
```

---

# HTTP Status Codes

| Code | Meaning          |
| ---- | ---------------- |
| 200  | Success          |
| 201  | Unauthorized     |
| 403  | Forbidden        |
| 422  | Validation Error |

---

# Authentication Usage Example

```javascript
// Sign In
const login = await fetch("/global/api/User/signIn", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({
    username: "email",
    password: "password"
  })
});

// Get Wallet
const wallet = await fetch("/global/api/UserApi/getAgentAllWallets", {
  method: "POST",
  credentials: "include"
});
```

---

# Best Practices

* Always store refreshToken securely
* Refresh accessToken before expiry
* Handle 401/403 errors properly
* Use HTTPS only

---

**End of Documentation**
