// Pure synthetic fixture; caller may materialize only after write authorization.
export function reportBytes(){const unit='The synthetic report states that satisfaction is 80% and loyalty is 40%. ';return Buffer.from(unit.repeat(Math.ceil(30000/unit.length)).slice(0,30000),'utf8');}
