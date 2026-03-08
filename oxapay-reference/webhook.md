# Webhook

Merchants can set up a `callback_url` in their merchant requests, and upon processing payments, OxaPay will send you notifications in JSON format—including the amount and status—when the payment&#x20;status changes to paying or paid.

To receive Webhook notifications, first, you should implement a standard HTTP POST (application/json) call over an HTTPS URL to a CGI script on your server. Insert your created endpoint address in the `callback_url` field of merchant requests. You will receive payment updates (statuses) to this URL address.

However, you will initially receive a callback with the "paying" status. You should wait for a second callback where the "status" value will be "paid". When we confirm the transaction, we are ready to manage all the risks concerning accepting real funds later. You should not be concerned about it.

Merchant's `callback_url` must return an HTTP 200 response with content "ok" for the OxaPay API to\
consider the callback successful. The system will try to deliver a Webhook notification up to 5 times or until a successful delivery occurs, whichever happens first. If the first attempt fails, the second one is triggered after approximately 1 minute. The third one is delayed for 3 more minutes, the fourth for 30 minutes, and the last one for 3 hours.

The payout Webhook is similar to the merchant Webhook. However, for withdrawals, you will receive different values for the “address” parameter in each callback.

## Validating Callbacks

Merchants must validate the signature of callbacks coming from OxaPay using their `MERCHANT_API_KEY` to prevent fraudulent activity. Also for payout Webhooks you must validate the signature using your `PAYOUT_API_KEY`. OxaPay uses your `MERCHANT_API_KEY` as the HMAC shared secret key to generate an HMAC (sha512) signature of the raw POST data. The HMAC signature is sent as an HTTP header called HMAC. The body of the request contains the callback data in JSON format, similar to the Payment Information API response body.

## Testing Webhook

For payment callback handling, you can use tools like [requestcatcher.com](https://requestcatcher.com) or [webhook.site](https://webhook.site/) to create a test `callback_url` and inspect the callback data sent from OxaPay. Note that OxaPay payment callbacks will not be sent to private networks (e.g., localhost).

For local debugging, you can use services like [ngrok.io](https://ngrok.io) to expose your local server to the internet and receive webhook callbacks.

**To utilize the payment webhook, please follow these steps:**

1\. Create a web server and define an endpoint to handle POST requests.

&#x20;  \- Ensure that the firewall software on your server (e.g., Cloudflare) allows incoming requests from OxaPay. You may need to whitelist OxaPay's IP addresses on your side. Please reach out to <support@oxapay.com> to obtain the list of IP addresses.

2\. Configure your server to receive POST requests at the specified endpoint URL.

&#x20;  \- The POST request body will contain the necessary parameters sent by OxaPay in JSON format.

3\. Validate the HMAC signature of the request to ensure the authenticity of the callback.

&#x20;  \- Use your API\_SECRET\_KEY to calculate the HMAC signature and compare it with the received HMAC header.

4\. Process the callback data accordingly based on the status and other parameters provided.

## Sample Payment IPN data

In this section, we will provide examples of the data OxaPay send to your system at various stages of the payment process.

### The input transaction types are:

* invoice
* white\_label
* static\_address
* payment\_link
* donation

```json
// Paying IPN
// Payer transferred the payment for the invoice. Awaiting blockchain network confirmation.
{
"track_id":"151811887", string
"status":"Paying", string
"type":"invoice", string
"module_name":"OxaPay", string
"amount":10, decimal
"value":3.6839, decimal
"sent_value": 3.6839, decimal
"currency":"POL", string
"order_id":"ORD-12345", string
"email":"customer@oxapay.com", string
"note":"", string
"fee_paid_by_payer":0, boolean
"under_paid_coverage":0, decimal
"description":"Test Description", string
"date":1738493900, integer
"txs":[{
    "status":"confirming", string
    "tx_hash":"x", string
    "sent_amount":10, decimal
    "received_amount":9.85, decimal
    "value":3.6839, decimal
    "sent_value": 3.6839, decimal
    "currency":"POL", string
    "network":"Polygon Network", string
    "sender_address": "x", string
    "address":"x", string
    "rate":0.36839, decimal
    "confirmations":10, integer
    "auto_convert_amount":0, decimal
    "auto_convert_currency":"USDT", string
    "date":1738494035 integer
    }]
}
```

```json
// Paid IPN
// Payment is confirmed by the network and has been credited to the merchant. Purchased goods/services can be safely delivered to the payer.
{
"track_id":"151811887", string
"status":"Paid", string
"type":"invoice", string
"module_name":"OxaPay", string
"amount":10, decimal
"value":3.6839, decimal
"sent_value": 3.6839, decimal
"currency":"POL", string
"order_id":"ORD-12345", string
"email":"customer@oxapay.com", string
"note":"", string
"fee_paid_by_payer":0, boolean 
"under_paid_coverage":0, decimal
"description":"Test Description", string
"date":1738493900, integer
"txs":[{
    "status":"confirmed", string
    "tx_hash":"x", string
    "sent_amount":10, decimal
    "received_amount":9.85, decimal
    "value":3.6839, decimal
    "sent_value": 3.6839, decimal
    "currency":"POL", string
    "network":"Polygon Network", string
    "sender_address": "x", string
    "address":"x", string
    "rate":0.36839, decimal
    "confirmations":250, integer
    "auto_convert_amount":3.62864, decimal
    "auto_convert_currency":"USDT", string
    "date":1738494035 integer
    }]
}
```

## Sample Payout IPN data

In this section, we will provide examples of the data OxaPay send to your system at various stages of the payout process.

### The output transaction types are:

* payout

```json
// Confirming IPN
// You payout request sent and awaiting blockchain network confirmation.
{
"track_id":"227296189", string
"status":"Confirming", string
"type":"payout", string
"tx_hash":"x", string
"address":"x", string
"amount":10.0, decimal
"value":4.01, decimal
"currency":"POL", string
"network":"Polygon Network", string
"description":"Order #12345", string
"date":1738492316 integer
}
```

```json
// Confirmed IPN
// Payout is confirmed by the network.
{
"track_id":"227296189", string
"status":"Confirmed", string
"type":"payout", string
"tx_hash":"x", string
"address":"x", string
"amount":10.0, decimal
"value":4.01, decimal
"currency":"POL", string
"network":"Polygon Network", string
"description":"Order #12345", string
"date":1738492316 integer
}
```

```json
// Failed IPN
// Payout is Failed.
{
"track_id":"227652478", string
"status":"Failed", string
"type":"payout", string
"tx_hash":"", string
"address":"x", string
"amount":10.0, decimal
"value":4.01, decimal
"currency":"POL", string
"network":"Polygon Network", string
"description":"Order #12345", string
"date":1738492316 integer
}
```

> Even if your request cannot be processed for any reason, we will still send the webhook payload.

## Example codes

{% tabs %}
{% tab title="PHP" %}

```php
<?php
// Get the request data
$postData = file_get_contents('php://input');
$data = json_decode($postData, true);

// Validate HMAC signature
if ($data['type'] === 'invoice') {
    $apiSecretKey = 'YOUR_MERCHANT_API_KEY';
} elseif ($data['type'] === 'payout') {
    $apiSecretKey = 'YOUR_PAYOUT_API_KEY';
} else {
    http_response_code(400);
    echo 'Invalid data.type';
    exit;
}

$hmacHeader = $_SERVER['HTTP_HMAC'];
$calculatedHmac = hash_hmac('sha512', $postData, $apiSecretKey);

if ($calculatedHmac === $hmacHeader) {
    // HMAC signature is valid
    // Process the callback data
    if ($data['type'] === 'payment') {
        echo 'Received payment callback: ' . json_encode($data);
        // Process payment data here
    } elseif ($data['type'] === 'payout') {
        echo 'Received payout callback: ' . json_encode($data);
        // Process payout data here
    }

    // Return HTTP Response 200 with content "OK"
    http_response_code(200);
    echo 'OK';
} else {
    // HMAC signature is not valid
    // Handle the error accordingly
    http_response_code(400);
    echo 'Invalid HMAC signature';
}
?>

```

{% endtab %}

{% tab title="Node.js" %}

```javascript
const http = require('http');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
    if (req.url === '/callback' && req.method === 'POST') {
        // Validate HMAC signature
        let postData = '';

        req.on('data', chunk => {
            postData += chunk;
        });

        req.on('end', () => {
            // Parse the JSON data
            let data = null;
            try {
                data = JSON.parse(postData);
            } catch (error) {
                res.statusCode = 400;
                res.end('Invalid JSON data');
                return;
            }

            const apiSecretKey = (data.type === 'payment') ? 'YOUR_MERCHANT_API_KEY' : 'YOUR_PAYOUT_API_KEY';
            const hmacHeader = req.headers['hmac'];
            const calculatedHmac = crypto
                .createHmac('sha512', apiSecretKey)
                .update(postData)
                .digest('hex');

            if (calculatedHmac === hmacHeader) {
                // HMAC signature is valid
                // Process the callback data based on the type
                if (data.type === 'invoice') {
                    console.log('Received payment callback:', data);
                    // Process payment data here
                } else if (data.type === 'payout') {
                    console.log('Received payout callback:', data);
                    // Process payout data here
                }

                // Return HTTP Response 200 with content "OK"
                res.statusCode = 200;
                res.end('OK');
            } else {
                // HMAC signature is not valid
                // Handle the error accordingly
                res.statusCode = 400;
                res.end('Invalid HMAC signature');
            }
        });
    } else {
        // Invalid path or method
        res.statusCode = 404;
        res.end('Not Found');
    }
});

server.listen(3000, () => {
    console.log('Server listening on port 3000');
});

```

{% endtab %}

{% tab title="Python" %}

```python
from flask import Flask, request
import hmac
import hashlib
import json

app = Flask(__name__)

@app.route('/callback', methods=['POST'])
def handle_callback():
    post_data = request.get_data(as_text=True)
    data = json.loads(post_data)

    # Validate HMAC signature
    if data['type'] == 'payment':
        api_secret_key = 'YOUR_MERCHANT_API_KEY'
    elif data['type'] == 'payout':
        api_secret_key = 'YOUR_PAYOUT_API_KEY'
    else:
        return 'Invalid data.type', 400
    hmac_header = request.headers.get('HMAC')
    post_data = request.get_data()
    calculated_hmac = hmac.new(api_secret_key.encode(), post_data, hashlib.sha512).hexdigest()

    if calculated_hmac == hmac_header:
        # HMAC signature is valid
        # Process the callback data
        if data['type'] == 'invoice':
            print('Received payment callback:', data)
            # Process payment data here
        elif data['type'] == 'payout':
            print('Received payout callback:', data)
            # Process payout data here
            # Return HTTP Response 200 with content "OK"
        return 'OK', 200
    else:
        # HMAC signature is not valid
        # Handle the error accordingly
        return 'Invalid HMAC signature', 400


if __name__ == '__main__':
    app.run(host='YOUR_HOST_ADDRESS',port=3000)
```

{% endtab %}
{% endtabs %}

Again, please note that these code snippets serve as examples and may require modifications based on your specific implementation and framework.
