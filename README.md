# Drupal chunked file upload widget

Adds a managed file widget that uploads files per chunks using pure JavaScript.

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
