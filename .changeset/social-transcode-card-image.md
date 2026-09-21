---
'@getmunin/backend-core': patch
---

Social: convert a webp, avif or tiff picture on the way out instead of dropping it.

A LinkedIn post published from a draft with no `mediaUrl` takes its picture from the
linked page's `og:image`. Every platform descriptor accepts only jpeg, png and gif, so a
site whose card image is a webp — which is most sites built in the last few years, and
every page whose image came from the Munin CMS, since CMS renditions are webp — hit
`fetchMedia`'s content-type guard, threw, and was swallowed by the best-effort scrape
path. The post went out as a wall of text and nothing said so.

`fetchMedia` now converts a decodable source the platform will not take: png when the
image is genuinely transparent, jpeg otherwise, checked with sharp's opacity stats rather
than the presence of an alpha channel — avif keeps an opaque alpha channel, and trusting
`hasAlpha` would turn every avif photo into a needlessly large png. The size ceiling is
enforced against the converted file, and a conversion that lands over it is refused rather
than sent for the platform to reject. An explicitly attached `mediaUrl` gets the same
treatment, so pointing a draft at a webp asset now works too.

The swallowed scrape failure also logs at warn rather than debug, so the next picture that
cannot be attached leaves a trace.
