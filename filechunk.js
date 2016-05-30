/*global jQuery, Drupal */
(function ($) {
  "use strict";

  function debug(message, object) {
    if (console && console.log) {
      if (message) {
        console.log(message);
      }
      if (object) {
        console.log(message);
      }
    }
  }

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
    xhr.onerror = function () {
      var response;
      try {
        response = JSON.parse(this.responseText);
        error(response);
      } catch (e) {
        response = {};
        error(response);
      }
    };
    xhr.onload = function () {
      var response;
      try {
        response = JSON.parse(this.responseText);
      } catch (e) {
        // @todo Error handling
        response = {};
        error(response);
      }
      // I do have no idea why this appens, but it does, a few errors in
      // firefox are considered as valid...
      if (200 !== this.status) {
        error(response);
        return;
      }
      // Else normal file processing
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

  function checkNumber(value) {
    if ("number" === typeof value) {
      return value;
    }
    if ("string" === typeof value) {
      value = parseInt(value, 10);
      if (isNaN(value)) {
        throw "Invalid argument, number is not a number";
      }
    } else {
      throw "Invalid argument, number is not a number";
    }
    return value;
  }

  /**
   * Drupal behavior.
   */
  Drupal.behaviors.filechunk = {

    attach: function (context, settings) {

      if (!window.FileReader) {
        return; // Let it go.
      }

      $(context).find(".filechunk-widget").once('filechunk', function () {
        $(this).each(function () {

          var
            parent      = $(this),
            upload      = parent.find('input[type=file]'),
            element     = upload.get(0),
            formInputs  = upload.closest('form').find('input:enabled:not(.filechunk-remove):not([type=file])'),
            items       = parent.find('.filechunk-thumbnail'),
            valueInput  = parent.find("[rel=fid]"),
            bar         = parent.find('.file-progress')
          ;

          // Configuration parse
          var
            token                 = element.getAttribute('data-token'),
            value                 = JSON.parse(element.getAttribute('data-default') || '{}'),
            isMultiple            = !!element.getAttribute('multiple'),
            chunksize             = checkNumber(element.getAttribute('data-chunksize') || (1024 * 1024 * 2)),
            uploadUrl             = element.getAttribute('data-uri-upload'),
            removeUrl             = element.getAttribute('data-uri-remove'),
            removeButtonTemplate  = element.getAttribute('data-tpl-remove') || '<button class="filechunk-remove btn btn-primary" type="submit" value="Remove">Remove</button>',
            itemPreviewTemplate   = element.getAttribute('data-tpl-item') || '<li data-fid="FID"></li>'
          ;

          if (!token) {
            throw "data-token is mandatory";
          }
          if (!uploadUrl) {
            throw "data-uri-upload is mandatory";
          }
          if (!removeUrl) {
            throw "data-uri-remove is mandatory";
          }

          // Create the error display div
          var errorZone = $('<div class="messages error file-upload-js-error" aria-live="polite"></div>');
          _hide(errorZone);
          parent.find('.filechunk-widget-drop').prepend(errorZone);

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
            if (!isMultiple) {
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
            //_enable(formInputs);
          };

          /**
           * Add new item to item list.
           */
          var _addItem = function (fid, hash, preview, item) {
            // When adding items in javascript, we don't care about the 'drop'
            // checkbox, since it will be fully handled by the javascript code.
            var remove = $(removeButtonTemplate);
            if (!item) {
              item = $(itemPreviewTemplate.replace('FID', fid));
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
            _remove(removeUrl, fid, token);

            // Remove item from FROM and settings.
            $(items).find('[data-fid=' + fid + ']').remove();
            delete value[fid];
            _updateValue();
          };

          /**
           * Show error message
           */
          var _showError = function (message) {
            errorZone.html(message);
            _show(errorZone);
          };

          /**
           * Hide error messages
           */
          var _hideError = function () {
            errorZone.html('');
            _hide(errorZone);
          };

          /**
           * For whatever that happens, this will run the file upload.
           */
          function onUploadChange (event) {
            event = event || window.event; // Old browser support.

            var files = this.files;
            if (!files || !files.length) {
              return; // Nothing to deal with...
            }

            _show(bar);
            //_disable(formInputs);

            // Now the hard part.
            var i = 0;
            var file = 0;
            for (i; files[i]; ++i) {
              file = files[i];
              _upload(uploadUrl, file, 0, chunksize, token, _updateProgress, function (response) {
                if (response.finished) {
                  _addItem(response.fid, response.hash, response.preview);
                }
              }, function (response) {
                if (response && response.message) {
                  _showError(response.message);
                }
              });
            }

            // Proceed with element replacement.
            var clone = this.cloneNode(true);
            this.parentNode.replaceChild(clone, this);
            clone.onchange = onUploadChange;
            _hideError();
            return false;
          }

          upload.get(0).onchange = onUploadChange;
          upload.get(0).ondrop = onUploadChange;

          // Adds the missing remove buttons from the start.
          items.find('li').each(function () {
            var fid = this.getAttribute('data-fid');
            if (!fid) {
              debug("Invalid item, removing it from data list", this);
              this.parent.removeChild(this);
            }
            _addItem(fid, null, null, $(this));
          });

          _refresh();

          return false;
        });
      });
    }
  };
}(jQuery));