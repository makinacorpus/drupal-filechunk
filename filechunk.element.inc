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
      // '#pre_render' => array('file_managed_file_pre_render'),
      // '#theme' => 'file_managed_file',
      // '#theme_wrappers' => array('form_element'),
      // '#upload_validators' => array(),
      '#process'            => ['filechunk_element_process'],
      '#value_callback'     => 'filechunk_element_value',
      '#element_validate'   => ['filechunk_element_validate'],
      '#upload_validators'  => [],
      '#append_remove'      => true,
      '#upload_location'    => null,
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

  $file = null;
  $denied = false;

  if ($input) {

    if (!empty($input['drop'])) {
      return null; // And yes, do not keep this frakking file.
    }

    if (!empty($input['fid'])) {
      // We might have no uploaded file actually, but we probably have a few
      // values that comes from the JavaScript, attempt to find this.
      if (empty($input['hash'])) {
        return;
      }
      $file = filechunk_element_check_file($input['fid'], $input['hash']);
      if (!$file) {
        form_error($element, t("Uploaded file is corrupted."));
        $denied = true;
      }
    } else {
      // Fallback on normal file upload, if any.
      $file = file_managed_file_save_upload($element);
    }

    // In all cases ensures the user is the rightful owner of the file and
    // can access it, if not, there is a security issue.
    if ($file) {

      $defaultLocation = $element['#upload_location'];
      if (!$defaultLocation) {
        $defaultLocation = "public://";
      }
      if (0 !== strpos($file->uri, $defaultLocation)) {
        $file = file_move($file, $defaultLocation);
        $file->status = FILE_STATUS_PERMANENT;
        if (!$file) {
          form_error($element, t("Could not move the uploaded file."));
          $denied = true;
        }
      }
    }
  }

  // When not in input mode, we are building the form from start and nothing
  // has been submitted, which means we must look at the default value, all
  // other cases are inputs. If the fid was messed-up with and user has no
  // access to the given file, just drop it and use default once again.
  if (!$input || $denied) {
    $file = null;
    if (isset($element['#default_value'])) {
      if (is_numeric($element['#default_value'])) {
        $file = file_load($element['#default_value']);
      } else if (is_object($element['#default_value']) && property_exists($element['#default_value'], 'fid')) {
        $file = $element['#default_value'];
      }
    }
  }

  return $file;
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
function filechunk_element_process($element) {
  $element['#tree'] = true;

  // Validate the input, input should be a file object, if a single fid is
  // given it should have been processed by filechunk_element_value().
  // In a few cases, but not all, the form API gives back the structure
  // array of the element, which is bad.
  if (isset($element['#value']) && is_object($element['#value']) && property_exists($element['#value'], 'fid')) {
    $value = $element['#value'];
  } else {
    $value = $element['#value'] = null;
  }

  $element['#theme_wrappers'] = ['form_element'];
  $element['#attributes']['class'][] = 'filechunk-widget';

  // Compute a predictable unique identifier for the field (there might be
  // more than one on the same screen).
  if (!empty($element['#field_parents'])) {
    // This is a field widget.
    $id = drupal_clean_css_identifier(implode('-', $element['#field_parents']));
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
  ];
  $element['progress'] = [
    '#prefix'         => '<div class="file-progress" style="display: none;">',
    '#suffix'         => '</div>',
    '#theme'          => 'progress_bar'
  ];
  // Placeholder for file preview.
  $element['filename'] = [
    '#markup'         => '',
    '#prefix'         => '<div class="filechunk-thumbnail" style="display: none;">',
    '#suffix'         => '</div>',
  ];
  $element['submit'] = [
    '#type'           => 'button',
    '#value'          => t("Upload"),
    '#attributes'     => ['class' => ['filechunk-upload'], 'disabled' => true, 'style' => "display: none;"],
  ];
  $element['remove'] = [
    '#type'           => 'button',
    '#value'          => t("Remove"),
    '#attributes'     => ['class' => ['filechunk-remove'], 'disabled' => true, 'style' => "display: none;"],
  ];

  // Hidden element containing the JavaScript result, if any.
  $element['fid'] = [
    '#type'           => 'hidden',
    '#attributes'     => ['rel' => 'fid'],
    '#default_value'  => $value ? $value->fid : null,
  ];
  $element['hash'] = [
    '#type'           => 'hidden',
    '#attributes'     => ['rel' => 'hash'],
    '#default_value'  => false,
  ];

  // Set the default preview value if any.
  if ($value) {
    unset($element['filename']['#markup']);
    $element['filename']['#theme'] = 'file_link';
    $element['filename']['#file'] = $value;

    // Add a 'remove' checkbox, ugly but working.
    if ($element['#append_remove']) {
      $element['drop'] = [
        '#type'           => 'checkbox',
        '#title'          => t("Remove file"),
        '#default_value'  => false,
        '#attributes'     => ['class' => ['filechunk-drop']],
      ];
    }
  }

  $settings = [
    // Keep a session driven token, there is no other way in order to
    // avoid form caching.
    'token' => drupal_get_token(),
    'chunksize' => variable_get('filechunk_chunk_size', 1024 * 1024 * 2),
    'url' => ['upload' => url('system/chunk-upload'), 'remove' => url('system/chunk-remove')],
  ];
  $element['#attached']['js'][] = [
    'type' => 'setting',
    'data' => ['filechunk' => [$id => $settings]],
  ];

  return $element;
}

/**
 * Valiate filechunk element.
 */
function filechunk_element_validate(&$element, &$form_state, $form) {
  form_set_value($element, $element['#value'], $form_state);
}
