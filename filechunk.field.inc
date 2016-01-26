<?php
/**
 * @file
 * Field API integration.
 */

/**
 * Implements hook_field_widget_info().
 */
function filechunk_field_widget_info() {
  return [
    'file_chunked' => [
      'label'       => t('Chunked file'),
      'description' => t("JavaScript file upload widget that sends file as chunks, useful for huge files and appropriate whenever you want to disable the Drupal form cache."),
      'field types' => ['file', 'image'],
      'settings'    => [],
    ],
  ];
}

/**
 * Implements hook_field_widget_settings_form().
 */
function filechunk_field_widget_settings_form($field, $instance) {
  return [];
}

/**
 * Implements hook_field_widget_form().
 */
function filechunk_field_widget_form(&$form, &$form_state, $field, $instance, $langcode, $items, $delta, $element) {
  return [
    '#type'               => 'file_chunked',
    '#default_value'      => empty($items[$delta]) ? null : (object)$items[$delta],
    '#upload_location'    => file_field_widget_uri($field, $instance),
    '#upload_validators'  => file_field_widget_upload_validators($field, $instance),
    '#convert_to_array'   => true,
  ];
}
