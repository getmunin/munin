---
"@getmunin/backend-core": minor
---

A Magento connection can be limited to one site of a multi-site install with an optional `storeCode`. With it set, every call goes to `/rest/<storeCode>/V1`, so product names, prices and currency come from that store view. Order lookups return only orders placed in a store view of the same Magento website, and product search and lookups return only products assigned to that website. Order-number lookups are scoped the same way, since increment ids can repeat across stores. `connectors_test_connection` fails when the code does not exist and lists the store view codes that do. Connections without a `storeCode` behave as before.
