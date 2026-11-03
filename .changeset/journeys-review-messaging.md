---
'@getmunin/backend-core': patch
'@getmunin/db': patch
'@getmunin/dashboard-pages': patch
---

Journey messaging fixes from review: outreach import never recreates journey proposals; when a journey run ends or the contact replies, its open proposals are withdrawn, and a journey proposal can no longer be approved or sent once its run has ended; auto email steps pin their email template's content at publish (it is part of the publish fingerprint), and an auto email whose template changed since is held for review instead of sent; two open journey emails to the same person on one campaign no longer collide on a unique index; the publish dialog shows each auto step's subject, text, marketing or transactional class and author; quiet-while-talking also covers contacts with no end user; transactional journey emails keep a working unsubscribe link; a person's journey texts share one SMS thread per channel; a failing event emit no longer turns a completed unsubscribe into an error; bounces count by address when the notice did not thread.
