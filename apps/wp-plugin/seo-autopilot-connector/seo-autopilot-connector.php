<?php
/**
 * Plugin Name:       SEO Autopilot Connector
 * Description:       Conecta tu tienda con SEO Autopilot: expone los campos de Yoast SEO y Rank Math a la API REST y publica los datos estructurados (JSON-LD) de los artículos generados.
 * Version:           1.3.0
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * Author:            SEO Autopilot
 * License:           GPL-2.0-or-later
 * Text Domain:       seo-autopilot-connector
 */

if (!defined('ABSPATH')) {
	exit;
}

define('SEO_AUTOPILOT_CONNECTOR_VERSION', '1.3.0');

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
 * Pedidos recientes con su página de entrada (atribución de pedidos de WooCommerce 8.5+).
 * Solo lo necesario para atribuir ventas a artículos: sin nombres, emails ni direcciones.
 */
add_action('rest_api_init', function () {
	register_rest_route('seo-autopilot/v1', '/orders', array(
		'methods'             => 'GET',
		'permission_callback' => function () {
			return current_user_can('view_woocommerce_reports') || current_user_can('manage_woocommerce');
		},
		'args'                => array(
			'after' => array('type' => 'string', 'required' => true),
			'page'  => array('type' => 'integer', 'default' => 1, 'minimum' => 1),
		),
		'callback'            => function (WP_REST_Request $request) {
			if (!function_exists('wc_get_orders')) {
				return new WP_Error('seo_autopilot_no_woocommerce', 'WooCommerce is not active', array('status' => 404));
			}
			$after = strtotime((string) $request->get_param('after'));
			if (!$after) {
				return new WP_Error('seo_autopilot_bad_date', 'Invalid "after" date', array('status' => 400));
			}
			$orders = wc_get_orders(array(
				'status'       => array('wc-processing', 'wc-completed'),
				'date_created' => '>' . $after,
				'limit'        => 100,
				'page'         => (int) $request->get_param('page'),
				'orderby'      => 'date',
				'order'        => 'ASC',
			));
			$out = array();
			foreach ($orders as $order) {
				if (!($order instanceof WC_Order)) {
					continue;
				}
				$created = $order->get_date_created();
				$out[] = array(
					'id'         => (string) $order->get_id(),
					'total'      => (float) $order->get_total(),
					'currency'   => $order->get_currency(),
					'createdAt'  => $created ? $created->date(DATE_ATOM) : null,
					'entry'      => (string) $order->get_meta('_wc_order_attribution_session_entry'),
					'sourceType' => (string) $order->get_meta('_wc_order_attribution_source_type'),
					'referrer'   => (string) $order->get_meta('_wc_order_attribution_referrer'),
					'utmSource'  => (string) $order->get_meta('_wc_order_attribution_utm_source'),
				);
			}
			return array('orders' => $out, 'hasMore' => count($orders) === 100);
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

/*
 * Visitas que ENTRAN por un artículo generado y de qué web vienen (Google, ChatGPT, redes...).
 * Sin cookies ni IP: el navegador manda el dominio de procedencia y aquí solo se suma un contador
 * diario por artículo y procedencia. Se hace con JavaScript para que funcione con caché de página.
 */
define('SEO_AUTOPILOT_VISITS_META', '_seo_autopilot_visits');
define('SEO_AUTOPILOT_VISITS_DAYS', 120);
define('SEO_AUTOPILOT_VISITS_MAX_SOURCES', 60);

function seo_autopilot_is_managed($post_id) {
	return get_post_type($post_id) === 'post'
		&& get_post_status($post_id) === 'publish'
		&& (string) get_post_meta($post_id, '_seo_autopilot_managed', true) !== '';
}

add_action('wp_footer', function () {
	if (!is_singular('post') || is_preview() || !seo_autopilot_is_managed(get_the_ID())) {
		return;
	}
	$endpoint = esc_url_raw(rest_url('seo-autopilot/v1/hit'));
	$post_id  = (int) get_the_ID();
	?>
<script class="seo-autopilot-visits">
(function () {
	try {
		if (navigator.webdriver || !navigator.sendBeacon) return;
		var bare = function (h) { return (h || '').toLowerCase().replace(/^www\./, ''); };
		var ref = document.referrer ? bare(new URL(document.referrer).hostname) : '';
		if (ref && ref === bare(location.hostname)) return; // navegación interna: no es una entrada
		var key = 'seo-autopilot-hit-<?php echo $post_id; ?>';
		if (sessionStorage.getItem(key)) return; // recargas de la misma sesión
		sessionStorage.setItem(key, '1');
		var utm = new URLSearchParams(location.search).get('utm_source') || '';
		navigator.sendBeacon(<?php echo wp_json_encode($endpoint); ?>, new Blob(
			[JSON.stringify({ post: <?php echo $post_id; ?>, ref: ref, utm: utm })],
			{ type: 'text/plain' }
		));
	} catch (e) {}
})();
</script>
	<?php
});

add_action('rest_api_init', function () {
	register_rest_route('seo-autopilot/v1', '/hit', array(
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => function (WP_REST_Request $request) {
			$body    = json_decode((string) $request->get_body(), true);
			$post_id = is_array($body) && isset($body['post']) ? (int) $body['post'] : 0;
			if ($post_id <= 0 || !seo_autopilot_is_managed($post_id)) {
				return new WP_REST_Response(null, 204);
			}
			// Vacío es válido (visita directa); cualquier otra cosa rara invalida la visita entera.
			$clean = function ($value, $pattern) {
				$value = strtolower(is_string($value) ? $value : '');
				return $value === '' || (strlen($value) <= 100 && preg_match($pattern, $value)) ? $value : null;
			};
			$ref = $clean($body['ref'] ?? '', '/^[a-z0-9.-]+$/');
			$utm = $clean($body['utm'] ?? '', '/^[a-z0-9._-]+$/');
			if ($ref === null || $utm === null) {
				return new WP_REST_Response(null, 204);
			}
			$source = $utm !== '' ? 'utm:' . $utm : $ref;

			$visits = get_post_meta($post_id, SEO_AUTOPILOT_VISITS_META, true);
			$visits = is_array($visits) ? $visits : array();
			$today  = gmdate('Y-m-d');
			$day    = isset($visits[$today]) && is_array($visits[$today]) ? $visits[$today] : array();
			if (!isset($day[$source]) && count($day) >= SEO_AUTOPILOT_VISITS_MAX_SOURCES) {
				$source = 'other';
			}
			$day[$source]   = (int) ($day[$source] ?? 0) + 1;
			$visits[$today] = $day;
			$oldest         = gmdate('Y-m-d', time() - SEO_AUTOPILOT_VISITS_DAYS * DAY_IN_SECONDS);
			foreach (array_keys($visits) as $date) {
				if ($date < $oldest) {
					unset($visits[$date]);
				}
			}
			update_post_meta($post_id, SEO_AUTOPILOT_VISITS_META, $visits);
			return new WP_REST_Response(null, 204);
		},
	));

	/** Visitas agregadas por artículo, día y procedencia desde `after` (YYYY-MM-DD). */
	register_rest_route('seo-autopilot/v1', '/visits', array(
		'methods'             => 'GET',
		'permission_callback' => function () {
			return current_user_can('edit_posts');
		},
		'args'                => array(
			'after' => array('type' => 'string', 'required' => true),
		),
		'callback'            => function (WP_REST_Request $request) {
			$after = (string) $request->get_param('after');
			if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $after)) {
				return new WP_Error('seo_autopilot_bad_date', 'Invalid "after" date', array('status' => 400));
			}
			$ids = get_posts(array(
				'post_type'      => 'post',
				'post_status'    => 'publish',
				'meta_key'       => SEO_AUTOPILOT_VISITS_META,
				'fields'         => 'ids',
				'posts_per_page' => -1,
				'no_found_rows'  => true,
			));
			$rows = array();
			foreach ($ids as $id) {
				$visits = get_post_meta($id, SEO_AUTOPILOT_VISITS_META, true);
				if (!is_array($visits)) {
					continue;
				}
				foreach ($visits as $date => $sources) {
					if ($date < $after || !is_array($sources)) {
						continue;
					}
					foreach ($sources as $source => $count) {
						$rows[] = array(
							'postId' => (int) $id,
							'date'   => (string) $date,
							'source' => (string) $source,
							'visits' => (int) $count,
						);
					}
				}
			}
			return array('visits' => $rows);
		},
	));
});

/*
 * SEO de las fichas de producto (WooCommerce). SEO Autopilot lee cada producto, propone cambios y
 * solo escribe los que el usuario acepta. Al escribir exige que el valor actual siga siendo el que
 * vio al proponerlo: si alguien lo ha editado mientras tanto, no se pisa (409).
 */
function seo_autopilot_seo_plugin() {
	if (defined('WPSEO_VERSION')) {
		return 'yoast';
	}
	if (class_exists('RankMath')) {
		return 'rankmath';
	}
	return null;
}

function seo_autopilot_seo_meta_key($field, $plugin) {
	$keys = array(
		'yoast'    => array(
			'focus_keyword'    => '_yoast_wpseo_focuskw',
			'seo_title'        => '_yoast_wpseo_title',
			'meta_description' => '_yoast_wpseo_metadesc',
		),
		'rankmath' => array(
			'focus_keyword'    => 'rank_math_focus_keyword',
			'seo_title'        => 'rank_math_title',
			'meta_description' => 'rank_math_description',
		),
	);
	return $plugin && isset($keys[$plugin][$field]) ? $keys[$plugin][$field] : null;
}

/**
 * Yoast sirve título y meta desde su tabla de "indexables", y guardar el producto no siempre la
 * regenera: sin esto, la meta nueva está en la base de datos pero no sale en la web. Rank Math lee
 * la meta directamente y no lo necesita.
 */
function seo_autopilot_refresh_seo_cache($post_id) {
	if (!function_exists('YoastSEO')) {
		return;
	}
	try {
		// El contenedor de Yoast no admite la barra inicial en el nombre de la clase.
		$repository = YoastSEO()->classes->get('Yoast\WP\SEO\Repositories\Indexable_Repository');
		$builder    = YoastSEO()->classes->get('Yoast\WP\SEO\Builders\Indexable_Builder');
		$indexable  = $builder->build_for_id_and_type($post_id, 'post', $repository->find_by_id_and_type($post_id, 'post', false));
		// En una petición REST el builder no lo persiste por sí solo.
		if ($indexable) {
			$indexable->save();
		}
	} catch (\Throwable $e) {
		// Una versión de Yoast sin esta API: la meta ya está guardada; Yoast la recogerá al reindexar.
	}
}

function seo_autopilot_product_image_ids($product) {
	$ids = array_merge(array((int) $product->get_image_id()), array_map('intval', $product->get_gallery_image_ids()));
	return array_values(array_unique(array_filter($ids)));
}

function seo_autopilot_term_names($product_id, $taxonomy) {
	$names = wp_get_post_terms($product_id, $taxonomy, array('fields' => 'names'));
	return is_wp_error($names) ? array() : array_values(array_map('strval', $names));
}

function seo_autopilot_product_snapshot($product) {
	$id     = $product->get_id();
	$plugin = seo_autopilot_seo_plugin();
	$meta   = function ($field) use ($id, $plugin) {
		$key = seo_autopilot_seo_meta_key($field, $plugin);
		return $key ? (string) get_post_meta($id, $key, true) : '';
	};
	$images = array();
	foreach (seo_autopilot_product_image_ids($product) as $image_id) {
		$images[] = array(
			'id'  => $image_id,
			'url' => (string) wp_get_attachment_image_url($image_id, 'thumbnail'),
			'alt' => (string) get_post_meta($image_id, '_wp_attachment_image_alt', true),
		);
	}
	$description = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags((string) $product->get_description())));
	$price       = (string) $product->get_price();
	return array(
		'id'               => $id,
		'name'             => (string) $product->get_name(),
		'url'              => (string) get_permalink($id),
		'status'           => (string) $product->get_status(),
		'shortDescription' => (string) $product->get_short_description(),
		'description'      => function_exists('mb_substr') ? mb_substr($description, 0, 2000) : substr($description, 0, 2000),
		'categories'       => seo_autopilot_term_names($id, 'product_cat'),
		'tags'             => seo_autopilot_term_names($id, 'product_tag'),
		'price'            => $price === '' ? null : $price,
		'images'           => $images,
		'seoPlugin'        => $plugin,
		'focusKeyword'     => $meta('focus_keyword'),
		'seoTitle'         => $meta('seo_title'),
		'metaDescription'  => $meta('meta_description'),
	);
}

/** Valor actual de un campo, en el mismo formato en que llega `expected`. */
function seo_autopilot_product_field_value($product, $field) {
	$snapshot = seo_autopilot_product_snapshot($product);
	switch ($field) {
		case 'focus_keyword':
			return $snapshot['focusKeyword'];
		case 'seo_title':
			return $snapshot['seoTitle'];
		case 'meta_description':
			return $snapshot['metaDescription'];
		case 'short_description':
			return $snapshot['shortDescription'];
		case 'tags':
			return $snapshot['tags'];
	}
	if (preg_match('/^image_alt:(\d+)$/', $field, $m)) {
		foreach ($snapshot['images'] as $image) {
			if ($image['id'] === (int) $m[1]) {
				return $image['alt'];
			}
		}
	}
	return null;
}

function seo_autopilot_same_value($current, $expected) {
	if (is_array($current) || is_array($expected)) {
		$norm = function ($list) {
			$list = array_map(function ($v) {
				return strtolower(trim((string) $v));
			}, is_array($list) ? $list : array());
			$list = array_values(array_unique(array_filter($list, 'strlen')));
			sort($list);
			return $list;
		};
		return $norm($current) === $norm($expected);
	}
	return trim((string) $current) === trim((string) $expected);
}

add_action('rest_api_init', function () {
	register_rest_route('seo-autopilot/v1', '/products', array(
		'methods'             => 'GET',
		'permission_callback' => function () {
			return current_user_can('edit_products');
		},
		'args'                => array(
			'page' => array('type' => 'integer', 'default' => 1, 'minimum' => 1),
			'ids'  => array('type' => 'string', 'default' => ''),
		),
		'callback'            => function (WP_REST_Request $request) {
			if (!function_exists('wc_get_products')) {
				return new WP_Error('seo_autopilot_no_woocommerce', 'WooCommerce is not active', array('status' => 404));
			}
			$args = array(
				'status'  => array('publish'),
				'limit'   => 50,
				'page'    => (int) $request->get_param('page'),
				'orderby' => 'ID',
				'order'   => 'ASC',
			);
			$ids = array_filter(array_map('intval', explode(',', (string) $request->get_param('ids'))));
			if ($ids) {
				$args['include'] = $ids;
				$args['limit']   = count($ids);
				$args['page']    = 1;
			}
			$products = wc_get_products($args);
			return array(
				'products' => array_map('seo_autopilot_product_snapshot', $products),
				'hasMore'  => !$ids && count($products) === 50,
			);
		},
	));

	register_rest_route('seo-autopilot/v1', '/products/(?P<id>\d+)', array(
		'methods'             => 'POST',
		'permission_callback' => function (WP_REST_Request $request) {
			return current_user_can('edit_product', (int) $request['id']);
		},
		'callback'            => function (WP_REST_Request $request) {
			if (!function_exists('wc_get_product')) {
				return new WP_Error('seo_autopilot_no_woocommerce', 'WooCommerce is not active', array('status' => 404));
			}
			$product = wc_get_product((int) $request['id']);
			if (!$product) {
				return new WP_Error('seo_autopilot_not_found', 'Product not found', array('status' => 404));
			}
			$body    = json_decode((string) $request->get_body(), true);
			$changes = is_array($body) && isset($body['changes']) && is_array($body['changes']) ? $body['changes'] : array();
			$plugin  = seo_autopilot_seo_plugin();

			// 1. Todo o nada: primero se comprueba que ningún campo ha cambiado desde la sugerencia.
			foreach ($changes as $change) {
				$field   = isset($change['field']) ? (string) $change['field'] : '';
				$current = seo_autopilot_product_field_value($product, $field);
				if ($current === null) {
					return new WP_Error('seo_autopilot_bad_field', 'Unknown field ' . $field, array('status' => 400));
				}
				if (in_array($field, array('focus_keyword', 'seo_title', 'meta_description'), true) && !$plugin) {
					return new WP_Error('seo_autopilot_no_seo_plugin', 'No SEO plugin active', array('status' => 400));
				}
				if (!seo_autopilot_same_value($current, $change['expected'] ?? '')) {
					return new WP_Error('seo_autopilot_changed', 'The product changed since the suggestion', array('status' => 409, 'field' => $field));
				}
			}

			// 2. Se aplican.
			foreach ($changes as $change) {
				$field = (string) $change['field'];
				$value = $change['value'] ?? '';
				if ($field === 'tags') {
					$tags = array_values(array_filter(array_map(function ($t) {
						return sanitize_text_field((string) $t);
					}, is_array($value) ? $value : array()), 'strlen'));
					wp_set_object_terms($product->get_id(), $tags, 'product_tag', false);
				} elseif ($field === 'short_description') {
					$product->set_short_description(wp_kses_post((string) $value));
				} elseif (preg_match('/^image_alt:(\d+)$/', $field, $m)) {
					update_post_meta((int) $m[1], '_wp_attachment_image_alt', sanitize_text_field((string) $value));
				} else {
					update_post_meta($product->get_id(), seo_autopilot_seo_meta_key($field, $plugin), sanitize_text_field((string) $value));
				}
			}
			$product->save();
			clean_post_cache($product->get_id());
			seo_autopilot_refresh_seo_cache($product->get_id());
			return seo_autopilot_product_snapshot(wc_get_product($product->get_id()));
		},
	));
});
