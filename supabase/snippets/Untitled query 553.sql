select occurred_at, event, left(detail::text, 300) as detail
from trace
order by occurred_at desc
limit 25;