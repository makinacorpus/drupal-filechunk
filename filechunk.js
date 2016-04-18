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
    if (xhr.overrideMimeType) {
      xhr.overrideMimeType("application/octet-stream");
    }

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
      if (this.style) {
        this.style.display = null;
      }
    });
  }

  /**
   * Hide element.
   *
   * @param DOMNode|selector element
   */
  function _hide(element) {
    $(element).each(function () {
      if (this.style) {
        this.style.display = "none";
      }
    });
  }

  /**
   * Adapted from Drupal core file.js.
   *
   * @param event
   */
  function _validateExtension(event) {
    // Remove any previous errors.
    $('.file-upload-js-error').remove();

    // Add client side validation for the input[type=file].
    var extensionPattern = event.data.extensions.replace(/,\s*/g, '|');
    if (extensionPattern.length > 1 && this.value.length > 0) {
      var acceptableMatch = new RegExp('\\.(' + extensionPattern + ')$', 'gi');
      if (!acceptableMatch.test(this.value)) {
        var error = Drupal.t("The selected file %filename cannot be uploaded. Only files with the following extensions are allowed: %extensions.", {
          // According to the specifications of HTML5, a file upload control
          // should not reveal the real local path to the file that a user
          // has selected. Some web browsers implement this restriction by
          // replacing the local path with "C:\fakepath\", which can cause
          // confusion by leaving the user thinking perhaps Drupal could not
          // find the file because it messed up the file path. To avoid this
          // confusion, therefore, we strip out the bogus fakepath string.
          '%filename': this.value.replace('C:\\fakepath\\', ''),
          '%extensions': extensionPattern.replace(/\|/g, ', ')
        });
        $('div.filechunk-widget-drop').prepend('<div class="messages error file-upload-js-error" aria-live="polite">' + error + '</div>');
        this.value = '';
        return false;
      }
    }
  }

  /**
   * Drupal behavior.
   */
  Drupal.behaviors.filechunk = {

    attach: function (context, settings) {
      var id, settings;

      if (!window.FileReader) {
        return; // Let it go.
      }
      if (!settings.filechunk) {
        return; // Failsafe.
      }
      if (!Drupal.settings.filechunk.list) {
        return; // No items to init.
      }

      for (id in Drupal.settings.filechunk.list) {
        var config = Drupal.settings.filechunk.list[id];

        if (!config) {
          return;
        }
        if (!config.chunksize) {
          config.chunksize = 1024 * 1024;
        }

        $(context).find("#" + id).once('filechunk', function () {
          $(this).bind('change', {extensions: config.extensions}, _validateExtension);
          $(this).each(function () {
            var
              upload      = $(this),
              formInputs  = upload.closest('form').find('input:enabled:not(.filechunk-remove):not([type=file])'),
              parent      = upload.closest('.filechunk-widget'),
              items       = parent.find('.filechunk-thumbnail'),
              value       = config.defaults,
              valueInput  = parent.find("[rel=fid]"),
              bar         = parent.find('.file-progress')
            ;

            // Javascript is active, therefore we need to remove graceful
            // downgrade stuff before proceeding.
            parent.find('.filechunk-drop').remove();
            parent.find('[rel=downgrade]').val('');
            _show(parent.find('.message'));
            upload.css({opacity: 0, position: "absolute", top: 0, left: 0, width: "100%", height: "100%"});

            /**
             * Update progress bar callback.
             */
            var _updateProgress = function (percent) {
              var percentage = parseInt(percent, 10) + '%';
              bar.find('.progress-bar').css('width', percentage).html(percentage);
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
              var key, hasValue = false;
              // Attempt deactivation of submit widget when in not multiple mode
              // to ensure that only one value may be uploaded.
              if (!config.multiple) {
                for (key in value) {
                  if (value.hasOwnProperty(key)) {
                    hasValue = true;
                    break;
                  }
                }
              }
              if (hasValue) {
                _disable(upload);
              } else {
                _enable(upload);
              }
              _hide(bar);
              _enable(formInputs);
            };

            /**
             * Add new item to item list.
             */
            var _addItem = function (fid, hash, preview, item) {
              // When adding items in javascript, we don't care about the 'drop'
              // checkbox, since it will be fully handled by the javascript code.
              var remove = $(config.template.remove);
              if (!item) {
                item = $('<li data-fid="' + fid + '"></li>');
              }
              $(items).append(item.append(preview).append(remove.on('click', _removeOnClick)));
              if (fid) {
                value[fid] = hash;
                _updateValue();
              }
            };

            /**
             * Remove item from server callback.
             */
            var _removeOnClick = function (event) {
              event.stopPropagation();
              event.preventDefault();

              var item = $(this).closest('li'), fid = item.attr('data-fid');
              _remove(config.url.remove, fid, config.token);

              // Remove item from FROM and settings.
              $(items).find('[data-fid=' + fid + ']').remove();
              delete value[fid];
              _updateValue();
            };

            /**
             * For whatever that happens, this will run the file upload.
             */
            function onUploadChange (event) {
              event = event || window.event; // Old browser support.

              var files = this.files, file, i = 0;
              if (!files || !files.length) {
                return; // Nothing to deal with...
              }

              _show(bar);
              _disable(formInputs);

              // Now the hard part.
              for (i, file; file = files[i]; ++i) {
                _upload(config.url.upload, file, 0, config.chunksize, config.token, _updateProgress, function (response) {
                  if (response.finished) {
                    _addItem(response.fid, response.hash, response.preview);
                  }
                }, function () {
                  _refresh();
                });
              }

              // Proceed with element replacement.
              var clone = this.cloneNode(true);
              this.parentNode.replaceChild(clone, this);
              clone.onchange = onUploadChange;
              $(this).bind('change', {extensions: config.extensions}, _validateExtension);
              return false;
            };

            upload.get(0).onchange = onUploadChange;
            upload.get(0).ondrop = onUploadChange;

            // Adds the missing remove buttons from the start.
            items.find('li').each(function () {
              _addItem(null, null, null, $(this));
            })

            _refresh();

            return false;
          });
        });
      }
    }
  };
}(jQuery));