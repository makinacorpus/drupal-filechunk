/*global jQuery, Drupal */
(function ($) {
  "use strict";

  /**
   * Not very proud of this, but it does work.
   *
   * @param string url
   * @param Blob file
   * @param int start
   * @param int step
   * @param string token
   * @param function progress
   * @param function complete
   *
   * @return void
   */
  function _upload(url, file, start, step, token, progress, complete) {
    var xhr;
    var stop = Math.min(start + step, file.size);

    xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-File-Name", file.name);
    xhr.setRequestHeader("Content-Range", "bytes " + start + "-" + stop + "/" + file.size);
    if (token) {
      xhr.setRequestHeader("X-File-Token", token);
    }
    xhr.overrideMimeType("application/octet-stream");

    xhr.onload = function () {
      var response;
      try {
        response = JSON.parse(this.responseText);
      } catch (e) {
        // @todo Error handling
        response = {};
      }
      if (file.size <= stop || response.finished) {
        complete(response);
        progress(100);
      } else {
        progress(Math.round((response.offset / file.size) * 100));
        if (response.resume && response.offset) {
          _upload(url, file, response.offset, step, token, progress, complete);
        } else {
          _upload(url, file, stop, step, token, progress, complete);
        }
      }
    };

    xhr.send(file.slice(start, stop));
  }

  /**
   * Remove a file if temporary on the server side.
   */
  function _remove(url, fid, token) {
    var xhr;
    xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-File-Id", fid);
    if (token) {
      xhr.setRequestHeader("X-File-Token", token);
    }
    xhr.send();
  }

  /**
   * Create a clone of the given element and replace the previous with it.
   *
   * @param DOMNode element
   *
   * @return DOMNode
   */
  function _emptyValue(element) {
    var previous = $(element);
    var replacement = previous.val('').clone(true);
    previous.replaceWith(replacement);
    previous.remove();
    return replacement.get(0);
  }

  /**
   * Drupal behavior.
   */
  Drupal.behaviors.filechunk = {

    attach: function (context) {
      var id, settings;

      if (!Drupal.settings.filechunk) {
        return; // Failsafe.
      }

      for (id in Drupal.settings.filechunk) {
        settings = Drupal.settings.filechunk[id];

        if (!settings) {
          return;
        }
        if (!settings.chunksize) {
          settings.chunksize = 1024 * 1024;
        }

        (function (id) {

          var
            upload  = $(context).find("#" + id),
            form    = upload.closest('form'),
            inputs  = form.find('input:enabled'),
            parent  = upload.closest('.filechunk-widget'),
            preview = parent.find('.filechunk-thumbnail'),
            submit  = parent.find(".filechunk-upload"),
            remove  = parent.find(".filechunk-remove"),
            drop    = parent.find('.filechunk-drop'),
            valFid  = parent.find("[rel=fid]"),
            valHash = parent.find("[rel=hash]"),
            bar     = parent.find('.file-progress'),
            files, file, i
          ;

          upload = upload.get(0);
          drop.hide();

          var _updateProgress = function (percent) {
            var value = parseInt(percent, 10) + '%';
            bar.find('.progress-bar').css('width', value).html(value);
          };

          var _refresh = function () {
            bar.hide();
            if (valFid.val()) {
              preview.show();
              submit.hide();
              submit.attr('disabled', 'disabled').addClass('disabled');
              remove.removeAttr('disabled').removeClass('disabled');
              remove.show();
              upload = _emptyValue(upload);
              $(upload).hide();
              drop.removeAttr('checked');
            } else{
              preview.hide();
              remove.hide();
              remove.attr('disabled', 'disabled').addClass('disabled');
              submit.removeAttr('disabled').removeClass('disabled');
              submit.show();
              upload = _emptyValue(upload);
              $(upload).show();
              drop.attr('checked', 'checked');
            }
          };

          _refresh();

          submit.on("click", function (event) {
            event.stopPropagation();
            event.preventDefault();

            files = upload.files;
            if (!files.length) {
              return false;
            }

            bar.show();

            if (form) {
              // Should disable all submit and buttons elements.
              inputs.attr('disabled', 'disabled').addClass('disabled');
            }

            // Now the hard part.
            for (i = 0, file; file = files[i]; ++i) {
              _upload(settings.url.upload, file, 0, settings.chunksize, settings.token, _updateProgress, function (response) {
                if (response.finished) {
                  // If we have a file, populate the form as-is.
                  if (response.fid) {
                    valFid.val(response.fid);
                  }
                  if (response.hash) {
                    valHash.val(response.hash);
                  }
                  if (response.preview) {
                    preview.html(response.preview);
                  } else {
                    if (response.filename) {
                      preview.html("<span class=\"text-muted\">" + response.filename + "</span>");
                    } else {
                      preview.html("<span class=\"text-muted\">" + Drupal.t("Upload complete") + "</span>");
                    }
                  }
                }
                // Re-enabled inputs when finished.
                inputs.removeAttr('disabled').removeClass('disabled');
                _refresh();
              });
            }

            return false;
          });

          remove.on("click", function (event) {
            event.stopPropagation();
            event.preventDefault();
            var fid = valFid.val();
            _remove(settings.url.remove, fid, settings.token);
            valFid.val('');
            _refresh();
            return false;
          });

        }(id));
      }
    }
  };
}(jQuery));