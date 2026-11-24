/* life.js — 人生倒计时核心算法（纯函数，可在 Node 中自测） */
(function (root) {
  'use strict';

  var DAY = 86400000;

  function parseDate(s) {
    if (s instanceof Date) return s;
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
  }

  function addYears(d, n) {
    var r = new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
    // 2/29 在非闰年顺延到 3/1
    if (r.getMonth() !== d.getMonth()) r = new Date(d.getFullYear() + n, d.getMonth() + 1, 1);
    return r;
  }

  /**
   * 计算人生刻度
   * opts: { birth: 'YYYY-MM-DD', expectancy: 80, today?: Date }
   */
  function compute(opts) {
    var birth = parseDate(opts.birth);
    if (!birth) throw new Error('生日格式无效');
    var today = opts.today ? startOfDay(opts.today) : startOfDay(new Date());
    var expectancy = Math.max(1, Math.min(130, Math.round(+opts.expectancy || 80)));

    var totalDays = daysBetween(birth, addYears(birth, expectancy));
    var passedDays = daysBetween(birth, today);
    var livedDays = Math.max(0, Math.min(totalDays, passedDays));
    var leftDays = Math.max(0, totalDays - livedDays);
    var pct = totalDays > 0 ? livedDays / totalDays : 1;

    var ageYears = today.getFullYear() - birth.getFullYear();
    var nextBD = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
    if (nextBD < today) nextBD = addYears(nextBD, 1);
    // 2/29 生日处理
    if (nextBD.getMonth() !== birth.getMonth()) nextBD = new Date(nextBD.getFullYear(), birth.getMonth() + 1, 1);

    // 每周一格网格：按周行进的人生方块
    var totalWeeks = Math.ceil(totalDays / 7);
    var livedWeeks = Math.floor(livedDays / 7);

    // 已活过的「人生阶段」统计
    var stats = {
      years: Math.floor(livedDays / 365.2425),
      months: Math.floor(livedDays / 30.436875),
      weeks: Math.floor(livedDays / 7),
      days: livedDays,
      hours: livedDays * 24,
      heartbeats: livedDays * 24 * 70,
      breaths: livedDays * 24 * 60 * 15,
      sleeps: Math.floor(livedDays / 3)  // 大约每 3 天 1 次
    };

    // 已过的周末（周五/周六 中国习惯常用）与生日
    var weekends = Math.floor(livedDays / 7) * 2;
    var birthdaysPassed = Math.max(0, ageYears - (nextBD <= today ? 0 : 1));

    return {
      birth: fmtDate(birth),
      today: fmtDate(today),
      expectancy: expectancy,
      totalDays: totalDays,
      livedDays: livedDays,
      leftDays: leftDays,
      pct: pct,
      yearsLeft: leftDays / 365.2425,
      nextBirthdayIn: Math.max(0, daysBetween(today, nextBD)),
      nextBirthday: fmtDate(nextBD),
      ageYears: ageYears,
      totalWeeks: totalWeeks,
      livedWeeks: livedWeeks,
      stats: stats,
      birthdaysPassed: birthdaysPassed,
      weekends: weekends,
      left: {
        years: Math.floor(leftDays / 365.2425),
        months: Math.floor(leftDays / 30.436875),
        weeks: Math.floor(leftDays / 7),
        weekends: Math.floor(leftDays / 7) * 2,
        summers: Math.floor(leftDays / 365.2425),
        fullMoons: Math.floor(leftDays / 29.53059)
      }
    };
  }

  function fmtDate(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fmtNum(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var api = { compute: compute, parseDate: parseDate, daysBetween: daysBetween, addYears: addYears, fmtNum: fmtNum, fmtDate: fmtDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LifeCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
