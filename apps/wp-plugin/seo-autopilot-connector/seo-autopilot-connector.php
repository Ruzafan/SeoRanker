<?php
/**
 * Plugin Name:       SEO Autopilot Connector
 * Description:       Conecta tu tienda con SEO Autopilot: expone los campos de Yoast SEO y Rank Math a la API REST y publica los datos estructurados (JSON-LD) de los artículos generados.
 * Version:           1.0.0
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * Author:            SEO Autopilot
 * License:           GPL-2.0-or-later
 * Text Domain:       seo-autopilot-connector
 */

if (!defined('ABSPATH')) {
	exit;
}

define('SEO_AUTOPILOT_CONNECTOR_VERSION', '1.0.0');

/**
 * Campos SEO que SEO Autopilot escribe por la API REST. Yoast y Rank Math no los registran con
 * show_in_rest, así que sin este plugin WordPress los descarta en silencio.
 */
function seo_autopilot_meta_keys() {
	return array(
		// Yoast SEO
		'_yoast_wpseo_focuskw',
		'_yoast_wpseo_metadesc',
		'_yoast_wpseo_title',
		// Rank Math
		'rank_math_focus_keyword',
		'rank_math_description',
		'rank_math_title',
		// Propios: JSON-LD del artículo y marca de "generado por SEO Autopilot".
		'_seo_autopilot_schema',
		'_seo_autopilot_managed',
	);
}

add_action('init', function () {
	foreach (seo_autopilot_meta_keys() as $key) {
		register_post_meta('post', $key, array(
			'show_in_rest'  => true,
			'single'        => true,
			'type'          => 'string',
			'auth_callback' => function () {
				return current_user_can('edit_posts');
			},
		));
	}
});

/** Estado del conector: SEO Autopilot lo consulta al probar la conexión. */
add_action('rest_api_init', function () {
	register_rest_route('seo-autopilot/v1', '/status', array(
		'methods'             => 'GET',
		'permission_callback' => function () {
			return current_user_can('edit_posts');
		},
		'callback'            => function () {
			$seo_plugin = null;
			if (defined('WPSEO_VERSION')) {
				$seo_plugin = 'yoast';
			} elseif (class_exists('RankMath')) {
				$seo_plugin = 'rankmath';
			}
			return array(
				'version'     => SEO_AUTOPILOT_CONNECTOR_VERSION,
				'seoPlugin'   => $seo_plugin,
				'woocommerce' => class_exists('WooCommerce'),
			);
		},
	));
});

/**
 * Datos estructurados del artículo (FAQPage, y Article si no hay plugin SEO que ya lo emita).
 * Se guarda como JSON en _seo_autopilot_schema; aquí se valida y se imprime en el <head>.
 */
add_action('wp_head', function () {
	if (!is_singular('post')) {
		return;
	}
	$raw = get_post_meta(get_the_ID(), '_seo_autopilot_schema', true);
	if (!is_string($raw) || $raw === '') {
		return;
	}
	$data = json_decode($raw, true);
	if (!is_array($data)) {
		return;
	}
	$json = wp_json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG);
	if ($json) {
		echo "\n<script type=\"application/ld+json\" class=\"seo-autopilot-schema\">" . $json . "</script>\n";
	}
}, 20);
