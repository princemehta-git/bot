# Prices

This endpoint allows you to retrieve the current prices of all cryptocurrencies supported by OxaPay.

## GET /common/prices

>

```json
{"openapi":"3.0.0","info":{"title":"Commons","version":"1.0.0"},"servers":[{"url":"https://api.oxapay.com/v1"}],"security":[],"paths":{"/common/prices":{"get":{"operationId":"prices","responses":{"200":{"description":"Successful operation","content":{"application/json":{"schema":{"type":"object","properties":{"data":{"type":"object","description":"Represents dynamic keys (currency symbol) with decimal values."},"message":{"type":"string","description":"A message containing additional information about the result of the request."},"error":{"type":"object","description":"An object that provides details about any errors that occurred.","nullable":true,"properties":{"type":{"type":"string","description":"Type of the error"},"key":{"type":"string","description":"Key related to the error"},"message":{"type":"string","description":"Error message"}}},"status":{"type":"integer","description":"The status of the request response. Typically provided as a numeric code (e.g., 200 for success or other codes for errors)."},"version":{"type":"string","description":"The version of the API being used."}}}}}}},"tags":["Prices"]}}}}
```
