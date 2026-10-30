CREATE TYPE "public"."host_stat_resolution" AS ENUM('5m', '1h');--> statement-breakpoint
CREATE TABLE "host_stat" (
	"client_id" varchar(128) NOT NULL,
	"host" varchar(64) NOT NULL,
	"resolution" "host_stat_resolution" DEFAULT '5m' NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"cpu_pct" real,
	"load1" real,
	"mem_free_pct" real,
	"swap_used_mb" integer,
	"disk_free_gb" real,
	"runners_busy" smallint,
	"runners_max" smallint,
	CONSTRAINT "host_stat_pkey" PRIMARY KEY("client_id","host","resolution","sampled_at"),
	CONSTRAINT "host_stat_host_format" CHECK ("host_stat"."host" ~ '^[a-z0-9][a-z0-9-]*$')
);
--> statement-breakpoint
ALTER TABLE "host_stat" ADD CONSTRAINT "host_stat_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Retention for host_stat: 5-minute samples for 7 days, then hourly averages
-- until 97 days. tasks-server calls this at start-up and every hour. `as_of` is
-- the current time, a parameter only so tests can fix it.
--
-- The cutoff is the start of an hour, so an hour is averaged only once all
-- its samples are past 7 days. host_stat_push refuses a sample older than 7
-- days, so no 5-minute row can arrive later for an hour already averaged.
-- That makes ON CONFLICT DO NOTHING safe, and running this twice changes
-- nothing the second time. A function runs inside one transaction, so the
-- insert and both deletes land together or not at all.
--
-- Returns the number of rows deleted.
CREATE FUNCTION host_stat_rollup(as_of timestamptz DEFAULT now()) RETURNS integer AS $$
DECLARE
  cutoff timestamptz := date_trunc('hour', as_of - interval '7 days');
  rolled integer;
  expired integer;
BEGIN
  INSERT INTO host_stat (client_id, host, resolution, sampled_at, cpu_pct,
    load1, mem_free_pct, swap_used_mb, disk_free_gb, runners_busy, runners_max)
  SELECT client_id, host, '1h', date_trunc('hour', sampled_at),
    avg(cpu_pct)::real, avg(load1)::real, avg(mem_free_pct)::real,
    round(avg(swap_used_mb))::integer, avg(disk_free_gb)::real,
    round(avg(runners_busy))::smallint, round(avg(runners_max))::smallint
  FROM host_stat
  WHERE resolution = '5m' AND sampled_at < cutoff
  GROUP BY client_id, host, date_trunc('hour', sampled_at)
  ON CONFLICT DO NOTHING;

  DELETE FROM host_stat WHERE resolution = '5m' AND sampled_at < cutoff;
  GET DIAGNOSTICS rolled = ROW_COUNT;

  DELETE FROM host_stat
  WHERE resolution = '1h' AND sampled_at < as_of - interval '97 days';
  GET DIAGNOSTICS expired = ROW_COUNT;

  RETURN rolled + expired;
END;
$$ LANGUAGE plpgsql;
