# Drupal chunked file upload widget

Adds a managed file widget that uploads files per chunks using pure JavaScript.

Version **1.x** carries its own JavaScript widget, which due to a recent regression
does not work with Internet Explorer 11 anymore. It will be as of now, unmaintained.

Version **2.x** brings a shared widget fully rewritten using TypeScript,
targetting es5, transpiled and polyfilled using Babel, which works gracefully
with IE11.

*Version 2.x drops the untested gracefull downgrade feature, which makes it*
*unusable with Internet Explorer <11 and with browsers which don't support the*
*FileReader API.*

## JavaScript source code

JavaScript source code is written using TypeScript, you can find it there:
https://github.com/makinacorpus/filechunk-front

## Side by side with Gulpifier

If you use the [gulpifier module](https://github.com/makinacorpus/drupal-gulpifier),
you should add these 2 lignes into your themes ```.info``` files:

```
settings[gulpifier_whitelist][css][] = filechunk:filechunk.css
settings[gulpifier_whitelist][js][] = filechunk:filechunk.js
```
