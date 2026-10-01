from app.ratelimit import DailyQuota, LoginGuard, RateLimiter
from conftest import event, post_log


def test_limiter_unit():
    t = [0.0]
    rl = RateLimiter(3, 60, clock=lambda: t[0])
    assert [rl.check("a")[0] for _ in range(4)] == [True, True, True, False]
    assert rl.check("b")[0] is True
    t[0] = 61
    assert rl.check("a")[0] is True


def test_limiter_memory_cap():
    rl = RateLimiter(1, 60, max_keys=3)
    assert all(rl.check(str(i))[0] for i in range(3))
    assert rl.check("new")[0] is False


def test_daily_quota():
    d = [1]
    q = DailyQuota(100, day_fn=lambda: d[0])
    assert q.add("a", 60) and not q.add("a", 60) and q.add("b", 60)
    d[0] = 2
    assert q.add("a", 60)


def test_api_rate_limit_per_ip(make_client):
    c = make_client(RATE_LIMIT_PER_MIN=5)
    codes = [post_log(c, event()).status_code for _ in range(8)]
    assert codes[:5] == [200] * 5 and codes[5:] == [429] * 3
    r = post_log(c, event())
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1


def test_rate_limit_per_ip_separate_when_proxied(make_client):
    c = make_client(RATE_LIMIT_PER_MIN=2, TRUST_PROXY="1", TRUST_CF_IP="1")
    h = lambda ip: {"CF-Connecting-IP": ip}
    assert [post_log(c, event(), headers=h("1.1.1.1")).status_code for _ in range(3)] == [200, 200, 429]
    assert post_log(c, event(), headers=h("2.2.2.2")).status_code == 200


def test_xff_ignored_without_trust_proxy(make_client):
    c = make_client(RATE_LIMIT_PER_MIN=2)
    codes = [post_log(c, event(), headers={"X-Forwarded-For": f"9.9.9.{i}"}).status_code for i in range(3)]
    assert codes == [200, 200, 429]   # подмена XFF не обходит лимит


def test_daily_byte_quota(make_client):
    c = make_client(MAX_BYTES_PER_IP_DAY=3000)
    codes = [post_log(c, event(user_text="a" * 800)).status_code for _ in range(5)]
    assert 429 in codes and codes[0] == 200


def test_login_guard_unit():
    t = [0.0]
    g = LoginGuard(3, 60, 100, 60, clock=lambda: t[0])
    for _ in range(3):
        g.fail("ip")
    assert g.locked_for("ip") > 0 and g.locked_for("other") == 0
    t[0] = 61
    assert g.locked_for("ip") == 0
    g.fail("ip"); g.success("ip")
    assert g._fails.get("ip") is None


def test_global_login_guard():
    g = LoginGuard(100, 60, 3, 30)
    for i in range(3):
        g.fail(f"ip{i}")
    assert g.locked_for("someone-else") > 0


def test_spoofed_cf_ip_ignored_behind_nginx(make_client):
    """За nginx напрямую (не через Cloudflare) CF-Connecting-IP подделывается клиентом — по умолчанию игнорируется."""
    c = make_client(RATE_LIMIT_PER_MIN=2, TRUST_PROXY="1")
    codes = [post_log(c, event(), headers={"CF-Connecting-IP": f"3.3.3.{i}", "X-Forwarded-For": "4.4.4.4"}).status_code for i in range(3)]
    assert codes == [200, 200, 429]
