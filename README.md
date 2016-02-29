# Drupal chunked file upload widget

Adds a managed file widget that uploads files per chunks using pure JavaScript
and a FileReader API polysill for older browsers.

## Side by side with Gulpifier

If you use the [gulpifier module](https://github.com/makinacorpus/drupal-gulpifier),
you should add these 2 lignes into your themes ```.info``` files:

```
settings[gulpifier_whitelist][css][] = filechunk:filechunk.css
settings[gulpifier_whitelist][js][] = filechunk:filechunk.js
```
