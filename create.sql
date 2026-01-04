create database p6sgrep8;
use p6sgrep8;
CREATE TABLE `access_log`
(
    `id`          bigint      NOT NULL AUTO_INCREMENT,
    `short_code`  varchar(10) NOT NULL,
    `access_time` timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `ip_address`  varchar(50)          DEFAULT NULL,
    `user_agent`  text,
    `referer`     text,
    PRIMARY KEY (`id`),
    KEY `idx_short_code` (`short_code`),
    KEY `idx_access_time` (`access_time`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE `url_mapping`
(
    `id`           bigint      NOT NULL AUTO_INCREMENT,
    `short_code`   varchar(10) NOT NULL,
    `original_url` text        NOT NULL,
    `created_at`   timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `expired_at`   timestamp   NULL     DEFAULT NULL,
    `creator`      varchar(50)          DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `short_code` (`short_code`),
    KEY `idx_short_code` (`short_code`),
    KEY `idx_created_at` (`created_at`)
) ENGINE = InnoDB
  AUTO_INCREMENT = 162410
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;


CREATE TABLE `url_stats`
(
    `short_code`      varchar(10) NOT NULL,
    `total_visits`    bigint           DEFAULT '0',
    `last_visit_time` timestamp   NULL DEFAULT NULL,
    PRIMARY KEY (`short_code`),
    KEY `idx_total_visits` (`total_visits`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci