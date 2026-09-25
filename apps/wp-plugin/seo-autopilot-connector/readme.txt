=== SEO Autopilot Connector ===
Requires at least: 5.6
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Conecta tu tienda WordPress/WooCommerce con SEO Autopilot.

== Descripción ==

* Expone a la API REST los campos de Yoast SEO y Rank Math (keyword principal, meta description y título SEO) para que SEO Autopilot pueda rellenarlos al publicar.
* Imprime en el <head> los datos estructurados (JSON-LD) de los artículos generados: preguntas frecuentes (FAQPage) y, si no usas un plugin SEO, Article.
* Añade /wp-json/seo-autopilot/v1/status para que SEO Autopilot compruebe que el conector está activo.

No guarda datos, no llama a servicios externos y no añade nada al front salvo el JSON-LD de los artículos que lo tengan.

== Instalación ==

1. Plugins → Añadir nuevo → Subir plugin → selecciona seo-autopilot-connector.zip.
2. Activa el plugin.
3. En SEO Autopilot: Ajustes → Probar conexión.

== Changelog ==

= 1.0.0 =
* Primera versión: meta de Yoast y Rank Math por REST, JSON-LD y endpoint de estado.
