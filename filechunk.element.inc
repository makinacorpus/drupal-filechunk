<?php
/**
 * @file
 * Drupal element definition.
 */

/**
 * Implements hook_element_info().
 */
function filechunk_element_info() {
  return [
    // Please note that this will upload managed Drupal files, and should
    // be used only this way.
    'file_chunked' => [
      '#input'              => true,
      '#process'            => ['filechunk_element_process'],
      '#value_callback'     => 'filechunk_element_value',
      '#element_validate'   => ['filechunk_element_validate'],
      '#upload_validators'  => [],
      '#transliterate_name' => true,
      // Use the next for Field API compatibility only.
      '#convert_to_array'   => false,
      // And the next one too (makes file field happy).
      '#arbitrary_values'   => [],
      '#append_remove'      => true,
      '#upload_location'    => null,
      // Element will work with multiple input, but if you set this you
      // MUST drop a file stdClass array as input, else it wouldn't
      // work.
      '#multiple'           => false,
      '#attached'           => ['library' => [['filechunk', 'widget']]],
    ],
  ];
}

/**
 * Ensure file is correct.
 *
 * @param int $fid
 *   File identifier.
 * @param int $hash
 *   File hash.
 *
 * @return stdClass
 *   Load file if all checks out.
 */
function filechunk_element_check_file($fid, $hash) {
  global $user;
  $file = file_load($fid);
  if (!$file = file_load($fid)) {
    return; // File is not managed.
  }
  if ($user->uid != $file->uid) {
    return; // Owner is not the owner.
  }
  if (!file_exists($file->uri)) {
    return; // File does not exists.
  }
  if (md5_file($file->uri) !== $hash) {
    return; // File is not the same.
  }
  return $file;
}

/**
 * Filechunk element value callback.
 *
 * This code has been greatly inspired by file_managed_file_value().
 */
function filechunk_element_value(&$element, $input = false, $form_state = null) {

  $files    = [];
  $defaults = [];

  if (isset($element['#default_value'])) {

    // Internally, the widget will always be multiple.
    if (!is_array($element['#default_value'])) {
      $element['#default_value'] = [$element['#default_value']];
    }

    foreach ($element['#default_value'] as $item) {
      if (is_numeric($item)) {
        if ($file = file_load($item)) {
          $defaults[(int)$item] = $file;
        } else {
          watchdog(__FUNCTION__, "Could not load file @id", ['@id' => $item], WATCHDOG_ERROR);
        }
      } else if (is_array($item) && !empty($item['fid'])) {
        $defaults[(int)$item['fid']] = (object)$item;
      } else if (is_object($item) && property_exists($item, 'fid')) {
        $defaults[(int)$item->fid] = $item;
      } else {
        // Just drop this element.
      }
    }
  }

  if ($input) {
    if (!empty($input['fid'])) {

      if ($input['fid'] === '{}') {
        $hasMap = [];
      } else {
        $hasMap = @json_decode($input['fid'], true);
        if (!$hasMap) {
          form_error($element, t("Uploaded files are corrupted."));
          return $defaults; // Invalid input.
        }
      }

      foreach ($hasMap as $fid => $info) {

        if (!is_array($info)) {
          // Input is invalid, but let's remain compatible with previous
          // JavaScript versions and consider this is a plain hash.
          $info = ['hash' => $info];
        }

        if (isset($defaults[$fid])) {
          // Nothing to do, file is default.
          $files[] = $defaults[$fid];
          continue;
        }

        if (!isset($info['hash'])) {
          // Attempt to use a file using identifier without giving an hash and
          // whose not present within defaults: security breakage attempt.
          form_error($element, t("Uploaded files are corrupted."));
          return $defaults;
        }

        $file = filechunk_element_check_file($fid, $info['hash']);
        if (!$file) {
          // No hash means corrupted upload, just ignore. This is not a security
          // issue since we don't let reuse of a non existing or another file.
          form_error($element, t("Uploaded file is corrupted."));
          continue;
        } else {
          $files[] = $file;
        }
      }
    } else {
      return array_values($defaults);
    }

    // In all cases ensures the user is the rightful owner of the file and
    // can access it, if not, there is a security issue.
    if ($files) {
      $reset = [];

      $defaultLocation = $element['#upload_location'];
      if (!$defaultLocation) {
        $defaultLocation = "public://";
      } else {
        file_prepare_directory($defaultLocation, FILE_CREATE_DIRECTORY | FILE_MODIFY_PERMISSIONS);
        $defaultLocation .= '/';
      }

      // Make this clear that this widget should not set the permanent status
      // by itself, ... We can't guarantee the form full validation and submit
      // will pass and we should not leave anything stalling as permanent.
      foreach ($files as $index => $file) {
        if (0 !== strpos($file->uri, $defaultLocation)) {
          $filename = $file->filename;
          if ($element['#transliterate_name'] && function_exists('transliteration_clean_filename')) {
            $filename = transliteration_clean_filename($filename);
          }
          $file = file_move($file, $defaultLocation . $filename);
          if (!$file) {
            form_error($element, t("Could not move the uploaded file."));
            unset($files[$index]);
          } else {
            $files[$index] = $file;
          }
        }
        $reset[] = $file->fid;
      }

      // By some wonderful and powerfull magic, sometime file entity cache
      // does not seems to be rightfully cleared and the image module inherits
      // from very wrong cached entries, and cause a few PHP errors to raise
      // up to the watchdog.
      entity_get_controller('file')->resetCache($reset);
    }
  }

  // When not in input mode, we are building the form from start and nothing
  // has been submitted, which means we must look at the default value, all
  // other cases are inputs. If the fid was messed-up with and user has no
  // access to the given file, just drop it and use default once again.
  if (!$input) {
    return array_values($defaults);
  }

  return $files;
}

/**
 * Wraps file input in a button.
 */
function theme_filechunk_file_input($variables) {
  return $variables['element']['#children'];
}

/**
 * Process filechunk element.
 *
 * This actually only spawns a file widget along some hidden filed up using
 * whatever are the chunked uploaded file information in order to be able to
 * find it back.
 */
function filechunk_element_process($element, &$form_state) {

  $element['#tree'] = true;

  $values   = [];
  $hashmap  = [];

  // There is no need to change value, because we have a value callback we will
  // always get something that has the right format at this point.
  if (isset($element['#value'])) {
    if (is_array($element['#value'])) {
      $values = $element['#value'];
    } else {
      $values = [$element['#value']];
    }
  }

  // Validate the input, input should be a file object, if a single fid is
  // given it should have been processed by filechunk_element_value().
  // In a few cases, but not all, the form API gives back the structure
  // array of the element, which is bad.
  foreach ($values as $value) {
    // Needs to be casted as string else the encoded JSON will be an an array
    // and it will explode in front script at JSON.parse().
    // 2-step array derefencing else it won't work with PHP <7.
    $temp = (array)$value;
    $hashmap[(string)$value->fid] = ['filename' => $temp['filename']];
  }

  $element['#value'] = $values;
  $element['#theme_wrappers'] = ['form_element'];
  $element['#attributes']['class'][] = 'filechunk-widget';

  // Compute a predictable unique identifier for the field (there might be
  // more than one on the same screen).
  if (!empty($element['#field_parents']) && !empty($element['#field_name'])) {
    // This is a field widget.
    $id = drupal_clean_css_identifier(implode('-', array_merge($element['#field_parents'], [$element['#field_name']])));
  } else if (false) {
    // This is a nested form element.
  } else {
    // We don't have enough information, this can break AJAX.
    $id = drupal_clean_css_identifier($element['#id']);
  }

  // Fallback element.
  $element['upload'] = [
    '#name'           => 'files[' . implode('_', $element['#parents']) . ']',
    '#type'           => 'file',
    '#id'             => $id,
    '#title'          => t('Choose a file'),
    '#title_display'  => 'invisible',
    '#theme_wrappers' => ['filechunk_file_input'],
    '#prefix'         => '<div class="filechunk-widget-table"><div class="filechunk-widget-row"><div class="filechunk-widget-drop"><span class="text-muted message">' . t("Drag and drop files or click here to add more files...") . '</span>',
    '#suffix'         => '</div></div></div>',
    '#attributes'     => [],
  ];
  if ($element['#multiple']) {
    $element['upload']['#attributes']['multiple'] = 'multiple';
  }

  // Hidden element containing the JavaScript result, if any.
  $element['fid'] = [
    '#type'           => 'hidden',
    '#attributes'     => ['rel' => 'fid'],
    '#default_value'  => json_encode((object)$hashmap),
  ];

  $removeButton = [
    '#type'       => 'button',
    '#value'      => t("Remove"),
    '#attributes' => ['class' => ['filechunk-remove']],
  ];

  // Keep a session driven token, there is no other way in order to
  // avoid default Drupal form caching.
  $element['upload']['#attributes'] += array_filter([
    'data-token'      => $token = drupal_get_token(),
    'data-chunksize'  => variable_get('filechunk_chunk_size', null),
    'data-uri-upload' => url('system/chunk-upload'),
    'data-uri-remove' => url('system/chunk-remove'),
    'data-tpl-remove' => theme('button', ['element' => $removeButton]),
    'data-tpl-item'   => '<li data-fid="FID"></li>',
  ]);

  // This is a workaround for the http://github.com/makinacorpus/drupal-badm
  // bootstrap based admin theme.
  foreach (element_children($element) as $key) {
    $element[$key]['#form_horizontal'] = false;
  }

  if (!empty($element['#upload_validators'])) {
    // Set it to 6 hours, more than necessary.
    cache_set('fc:' . $token, $element['#upload_validators'], variable_get('filechunk_validators_cache_bin', 'cache'), time() + 3600 * 6);
  }

  return $element;
}

/**
 * Valiate filechunk element.
 */
function filechunk_element_validate(&$element, &$form_state, $form) {
  // There is no need to change value, because we have a value callback we will
  // always get something that has the right format at this point.
  if ($element['#convert_to_array']) {
    foreach ($element['#value'] as $index => $file) {
      $element['#value'][$index] = (array)$file;
      if ($element['#arbitrary_values']) {
        $element['#value'][$index] += $element['#arbitrary_values'];
      }
    }
    form_set_value($element, $element['#value'], $form_state);
  }
}
