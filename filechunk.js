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
  function _upload(url, file, start, step, token, progress, complete, error) {
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

    xhr.onerror = error;
    xhr.onload = function () {
      var response;
      try {
        response = JSON.parse(this.responseText);
      } catch (e) {
        // @todo Error handling
        response = {};
        error();
      }
      if (file.size <= stop || response.finished) {
        complete(response);
        progress(100);
      } else {
        progress(Math.round((response.offset / file.size) * 100));
        if (response.resume && response.offset) {
          _upload(url, file, response.offset, step, token, progress, complete, error);
        } else {
          _upload(url, file, stop, step, token, progress, complete, error);
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
   * Simple warning message when the window closes.
   *
  function _warn() {
    return Drupal.t("There is a file upload in progress, are you sure you want to close this window ?");
  }
   */

  /**
   * Disable element.
   *
   * @param DOMNode|selector element
   */
  function _disable(element) {
    $(element).attr('disabled', 'disabled').addClass('disabled');
  }

  /**
   * Enable element.
   *
   * @param DOMNode|selector element
   */
  function _enable(element) {
    $(element).removeAttr('disabled').removeClass('disabled');
  }

  /**
   * Show element.
   *
   * @param DOMNode|selector element
   */
  function _show(element) {
    $(element).each(function () {
      this.style.display = null;
    });
  }

  /**
   * Hide element.
   *
   * @param DOMNode|selector element
   */
  function _hide(element) {
    $(element).each(function () {
      this.style.display = "none";
    });
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
            upload      = $(context).find("#" + id),
            formInputs  = upload.closest('form').find('input:enabled:not(.filechunk-remove)'),
            parent      = upload.closest('.filechunk-widget'),
            items       = parent.find('.filechunk-thumbnail'),
            value       = settings.defaults,
            valueInput  = parent.find("[rel=fid]"),
            bar         = parent.find('.file-progress'),
            uploadClone, files, file, i
          ;

          // Javascript is active, therefore we need to remove graceful
          // downgrade stuff before proceeding.
          parent.find('.filechunk-drop').remove();
          parent.find('[rel=downgrade]').val('');
          upload.css({opacity: 0, position: "absolute", top: 0, left: 0, bottom: 0, right: 0});
          uploadClone = upload.clone(true);
          upload = upload.get(0);

          /**
           * For whatever that happens, this will run the file upload.
           */
          var _onAnythingDoUpload = function (event) {
            event.stopPropagation();
            event.preventDefault();

            files = upload.files;
            if (!files.length) {
              return false;
            }

            _show(bar);
            _disable(formInputs);

            // Now the hard part.
            for (i = 0, file; file = files[i]; ++i) {
              _upload(settings.url.upload, file, 0, settings.chunksize, settings.token, _updateProgress, function (response) {
                if (response.finished) {
                  _addItem(response.fid, response.hash, response.preview);
                }
              }, function () {
                _refresh();
              });
            }
          };

          /**
           * Create a clone of the given element and replace the previous with it.
           *
           * @param DOMNode element
           *
           * @return DOMNode
           */
          function _recreateUploadInput(element) {
            var previous = $(element);
            var replacement = uploadClone.clone(true);
            previous.replaceWith(replacement);
            previous.remove();
            $(replacement).on("change", _onAnythingDoUpload);
            return replacement.get(0);
          }

          /**
           * Update progress bar callback.
           */
          var _updateProgress = function (percent) {
            var value = parseInt(percent, 10) + '%';
            bar.find('.progress-bar').css('width', value).html(value);
          };

          /**
           * Restore value into the right form input.
           */
          var _updateValue = function () {
            valueInput.val(JSON.stringify(value));
            _refresh();
          };

          /**
           * Refresh UI (enable, disable buttons and submits).
           */
          var _refresh = function () {
            var hasValue = false;
            // Attempt deactivation of submit widget when in not multiple mode
            // to ensure that only one value may be uploaded.
            if (!settings.multiple) {
              $.each(value, function (index) {
                // "null" exists when delete is being used... WTF JS.
                if (index && "null" !== index) {
                  hasValue = true;
                }
              });
              if (hasValue) {
                _disable(upload);
              } else {
                _enable(upload);
              }
            }
            upload = _recreateUploadInput(upload);
            _hide(bar);
            _enable(formInputs);
          };

          /**
           * Add new item to item list.
           */
          var _addItem = function (fid, hash, preview, item) {
            // When adding items in javascript, we don't care about the 'drop'
            // checkbox, since it will be fully handled by the javascript code.
            var remove = $(settings.template.remove);
            if (!item) {
              item = $('<li data-fid="' + fid + '"></li>');
            }
            $(items).append(item.append(preview).append(remove.on('click', _removeOnClick)));
            value[fid] = hash;
            _updateValue();
          };

          /**
           * Remove item from item list.
           */
          var _removeItem = function (fid) {
            $(items).find('[data-fid=' + fid + ']').remove();
            delete value[fid];
            _updateValue();
          };

          /**
           * Remove item from server callback.
           */
          var _removeOnClick = function (event) {
            event.stopPropagation();
            event.preventDefault();
            var item = $(this).closest('li'), fid = item.attr('data-fid');
            _remove(settings.url.remove, fid, settings.token);
            _removeItem(fid);
          };

          // Adds the missing remove buttons from the start.
          items.find('li').each(function () {
            _addItem(null, null, null, $(this));
          })
          _refresh();

          $(upload).on("change", _onAnythingDoUpload);
        }(id));
      }
    }
  };
}(jQuery));