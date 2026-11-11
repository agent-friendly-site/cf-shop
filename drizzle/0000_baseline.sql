CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`shop`) REFERENCES `shops`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`event` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`actor` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_order` ON `order_events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`items_json` text NOT NULL,
	`subtotal_cny` real NOT NULL,
	`shipping_cny` real NOT NULL,
	`total_cny` real NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text,
	`buyer_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`verified_amount_cny` real,
	`verified_at` text,
	`verification_note` text,
	`buyer_name` text,
	`buyer_contact` text,
	`shipping_address` text,
	`carrier` text,
	`tracking_number` text,
	`shipped_at` text,
	`completed_at` text,
	`cancelled_at` text,
	`cancel_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_orders_shop` ON `orders` (`shop`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`shop`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`shop` text NOT NULL,
	`method_id` text NOT NULL,
	`label` text NOT NULL,
	`instructions` text NOT NULL,
	PRIMARY KEY(`shop`, `method_id`),
	FOREIGN KEY (`shop`) REFERENCES `shops`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payment_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`payment_method` text NOT NULL,
	`transaction_id` text,
	`amount_cny` real,
	`proof_type` text DEFAULT 'transaction' NOT NULL,
	`r2_key` text,
	`file_name` text,
	`mime_type` text,
	`file_size` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_proofs_order` ON `payment_proofs` (`order_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`name` text NOT NULL,
	`name_zh` text,
	`price` real NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`description` text,
	`url` text,
	`image_url` text,
	`image_credit` text,
	FOREIGN KEY (`shop`) REFERENCES `shops`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_products_shop` ON `products` (`shop`);--> statement-breakpoint
CREATE TABLE `proof_upload_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`order_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_upload_tokens_order` ON `proof_upload_tokens` (`order_id`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`shop` text NOT NULL,
	`product_id` text NOT NULL,
	`best_for` text,
	`why` text,
	`alternative_if_out` text,
	`rank` integer NOT NULL,
	PRIMARY KEY(`shop`, `product_id`),
	FOREIGN KEY (`shop`) REFERENCES `shops`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shop_admin_keys` (
	`shop` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`shop`) REFERENCES `shops`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shop_bundles` (
	`shop` text NOT NULL,
	`name` text NOT NULL,
	`items_json` text NOT NULL,
	`total_cny` real NOT NULL,
	`note` text,
	PRIMARY KEY(`shop`, `name`),
	FOREIGN KEY (`shop`) REFERENCES `shops`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shop_payment` (
	`shop` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`flow_json` text NOT NULL,
	`never_in_chat_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`shop`) REFERENCES `shops`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shop_policies` (
	`shop` text PRIMARY KEY NOT NULL,
	`shipping_flat_cny` real NOT NULL,
	`free_over_cny` real NOT NULL,
	`lead_time` text NOT NULL,
	`returns_window_days` integer NOT NULL,
	`returns_condition` text,
	`return_shipping` text,
	`privacy` text,
	`order_statuses` text NOT NULL,
	FOREIGN KEY (`shop`) REFERENCES `shops`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_zh` text,
	`category` text,
	`description` text,
	`city` text,
	`latitude` real,
	`longitude` real,
	`address` text,
	`pickup` text,
	`currency` text DEFAULT 'CNY' NOT NULL
);
