<?php
/**
 * AJAX callback(s).
 */

/**
 * Every one needs to die sometime.
 *
 * @param string $message
 */
function _filechunk_upload_die($message) {
  drupal_json_output(['message' => $message, 'error' => true]);
  drupal_add_http_header('Status', '500 Technical Error');
  die();
}

/**
 * Get managed file from file path.
 *
 * @param string $filename
 *
 * @return stdClass
 *   File is not saved
 */
function _filechunk_managed_file_get($filename, $filesize = null) {
  global $user;

  $uri = file_stream_wrapper_uri_normalize($filename);

  // Try to load the file whenever it exists as temporary.
  $fid = db_query("SELECT fid FROM {file_managed} WHERE uri = ?", [$uri])->fetchField();
  if ($fid) {
    $file = file_load($fid);
    // @todo Should check a bit more for security?
    // In all case harm has been done since we did write the file.
  } else {
    $file = new stdClass();
  }

  // File has been finished, write the Drupal managed file and return the
  // new file identifier to the JavaScript file.
  $file->uid = $user->uid;
  $file->filename = drupal_basename($uri);
  $file->uri = $uri;
  $file->filemime = file_get_mimetype($uri);
  $file->filesize = $filesize ? $filesize : @filesize($uri);
  $file->timestamp = time();
  $file->status = 0;

  return $file;
}

/**
 * Menu callback.
 */
function filechunk_remove_callback() {
  global $user;

  $fid        = $_SERVER['HTTP_X_FILE_ID'];
  $file       = file_load($fid);
  $directory  = filechunk_upload_dir_get();

  if (!$file) {
    return drupal_json_output(['remove' => false]);
  }

  $directory = file_stream_wrapper_uri_normalize($directory);
  if (0 !== strpos($file->uri, $directory)) {
    return drupal_json_output(['remove' => false]);
  }
  if ($user->uid != $file->uid) {
    return drupal_json_output(['remove' => false]);
  }

  unlink($file->uri);
  file_delete($file);

  return drupal_json_output(['remove' => true]);
}

/**
 * Ensure contraints from current HTTP input
 */
function filechunk_upload_ensure_constraints($file, $token) {
  $item = cache_get('fc:' . $token, variable_get('filechunk_validators_cache_bin', 'cache'));
  if (!$item) {
    return [t("Input field has expired, please reload the form")];
  }
  return file_validate($file, $item->data);
}

/**
 * Menu callback.
 *
 * I have to admit that the http://www.drupal.org/project/plupload module did
 * help me a lot writing this code, even thought I made it diverge a lot.
 */
function filechunk_upload_callback() {

  global $user;

  $filename = $_SERVER['HTTP_X_FILE_NAME'];
  // File name might be encoded in base64 to avoid encoding errors
  if ('==' === substr($filename, -2) || (false === strpos($filename, '.') && preg_match('#^@[a-zA-Z0-9+/]+={0,2}$#', $filename))) {
    $filename = base64_decode($filename);
  }

  $directory  = filechunk_upload_dir_get() . $user->uid;
  $absolute   = $directory . '/' . $filename;

  list($start, $stop, $filesize) = filechunk_parse_range($_SERVER['HTTP_CONTENT_RANGE']);
  $start      = (int)$start;
  $stop       = (int)$stop;
  $filesize   = (int)$filesize;
  $maxlength  = $stop - $start;
  $token      = isset($_SERVER['HTTP_X_FILE_TOKEN']) ? $_SERVER['HTTP_X_FILE_TOKEN'] : null;
  $file       = _filechunk_managed_file_get($absolute, $filesize);

  // Proceed with #upload_validators, because we don't want to cache forms since
  // this module was originally designed to avoid that, we will use a temporary
  // cache entry to store the validators.
  if ($token) {
    $errors = filechunk_upload_ensure_constraints($file, $token);
    if ($errors) {
      return _filechunk_upload_die(implode("\n", $errors));
    }
  }

  if (!file_prepare_directory($directory, FILE_CREATE_DIRECTORY | FILE_MODIFY_PERMISSIONS)) {
    return _filechunk_upload_die(t("Cannot create temporary directory"));
  }

  // Check for file metadata.
  $metadataFilename = $absolute . '.metadata.json';

  if (!file_exists($metadataFilename)) {
    $metadata = (object)['offset' => 0, 'size' => $filesize];

    // Allow users to resume a crashed upload they started themselves.
    $uploadIsFinished = $metadata->offset === $metadata->size;

    // Create the file with allocated size.
    if ($uploadIsFinished && file_exists($absolute)) {
      return _filechunk_upload_die(t("Cannot overwrite another file"));
    }

    if ($metadata->size !== $filesize) {
      // If filesize does not match, this probably means that another file is
      // being sent or the JavaScript is corrupted.
      return _filechunk_upload_die(t("File size does not match"));
    }

    // This solution comes from https://stackoverflow.com/a/3608405/5826569
    // Best answer ever to this!
    if (!$out = fopen($absolute, 'cb')) { // Allows overwrite.
      return _filechunk_upload_die(t("Cannot create file"));
    }
    fseek($out, $filesize - 1);
    fwrite($out, 'a');

  } else {

    $metadata = @json_decode(file_get_contents($metadataFilename));
    if (!$metadata) {
      // Delete the metadata file since it's invalid.
      unlink($metadataFilename);
      return _filechunk_upload_die(t("Unable to load metadata"));
    }

    if (!file_exists($absolute)) {
      // Delete the metadata file since it's probably something that stalled.
      unlink($metadataFilename);
      return _filechunk_upload_die(t("File should exists"));
    }

    if ($metadata->size !== $filesize) {
      // If filesize does not match, this probably means that another file is
      // being sent or the JavaScript is corrupted.
      return _filechunk_upload_die(t("File size does not match"));
    }

    if (!$out = fopen($absolute, 'cb')) {
      return _filechunk_upload_die(t("Could not open output stream"));
    }
  }

  if ($metadata->offset !== $start) {
    fclose($out);
    if ($filesize <= $metadata->offset) {

      // Update file metatada, since the file was potentially previously
      // incomplete, we must ensure that the saved data about our file is
      // correct
      $file->filemime = file_get_mimetype($file->uri);
      $file->filesize = @filesize($file->uri);
      file_save($file);

      @unlink($metadataFilename);
      $preview = filechunk_element_file_display($file);
      return drupal_json_output([
        'finished'  => true,
        'preview'   => render($preview),
        'fid'       => $file->fid,
        'writen'    => 0,
        'hash'      => md5_file($file->uri),
        'filename'  => $file->filename,
      ]);
    } else {
      return drupal_json_output([
        'finished'  => false,
        'resume'    => true,
        'writen'    => 0,
        'offset'    => $metadata->offset,
      ]);
    }
  }

  // Read binary input stream and prey.
  $in = fopen("php://input", "rb");
  if (!$in) {
    fclose($out);
    return _filechunk_upload_die(t("Could not open input stream"));
  }

  // Write chunk into file.
  if (-1 === fseek($out, $start)) {
    return _filechunk_upload_die(t("Could not seek output stream"));
  }
  $writen = stream_copy_to_stream($in, $out, $maxlength);
  fclose($out);
  fclose($in);

  $metadata->offset = $stop;
  file_put_contents($metadataFilename, json_encode($metadata));

  if ($filesize <= $stop) {

    // Update file metatada, since the file was potentially previously
    // incomplete, we must ensure that the saved data about our file is
    // correct
    $file->filemime = file_get_mimetype($file->uri);
    $file->filesize = @filesize($file->uri);
    file_save($file);

    @unlink($metadataFilename);
    $preview = filechunk_element_file_display($file);
    return drupal_json_output([
      'finished'  => true,
      'preview'   => render($preview),
      'fid'       => $file->fid,
      'writen'    => $writen,
      'hash'      => md5_file($file->uri),
      'filename'  => $file->filename,
    ]);
  } else {
    return drupal_json_output([
      'finished'  => false,
      'writen'    => $writen,
      'offset'    => $metadata->offset,
    ]);
  }
}
