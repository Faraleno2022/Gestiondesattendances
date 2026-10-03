'use strict';

// All user-facing text lives here. To add a language: add an entry to MESSAGES,
// add its code to LANGS, and add an <option> to the language selector in index.html.
const I18N = (() => {
  const LANGS = ['fr', 'en', 'zh-CN'];
  const DEFAULT_LANG = 'fr';

  const MESSAGES = {
    fr: {
      'app.title': 'Gestion des présences',
      'app.language': 'Langue',

      'login.title': 'Connexion',
      'login.username': 'Identifiant',
      'login.password': 'Mot de passe',
      'login.submit': 'Se connecter',
      'login.logout': 'Déconnexion',

      'nav.attendance': 'Pointage',
      'nav.people': 'Personnel',
      'nav.stats': 'Statistiques',

      'common.matricule': 'Matricule',
      'common.name': 'Nom complet',
      'common.jobTitle': 'Fonction',
      'common.service': 'Service / Département',
      'common.allServices': 'Tous les services',
      'common.search': 'Rechercher (nom, matricule…)',
      'common.edit': 'Modifier',
      'common.save': 'Enregistrer',
      'common.cancel': 'Annuler',
      'common.delete': 'Supprimer',
      'common.actions': 'Actions',
      'common.exportPdf': 'Exporter en PDF',
      'common.exportExcel': 'Exporter en Excel',
      'common.countLabel': '{label} : {n}',
      'common.saved': 'Enregistré',

      'export.generatedAt': 'Édité le {date}',
      'export.page': 'Page {page} / {pages}',
      'export.period': 'Période du {from} au {to}',
      'export.search': 'Recherche : « {q} »',

      'status.present': 'Présent',
      'status.absent': 'Absent',
      'status.late': 'En retard',
      'status.excused': 'Excusé',

      // One-letter codes shown in the cells of the monthly sheet.
      'statusCode.present': 'P',
      'statusCode.absent': 'A',
      'statusCode.late': 'R',
      'statusCode.excused': 'E',

      'attendance.month': 'Mois',
      'attendance.thisMonth': 'Mois en cours',
      'attendance.prevMonth': 'Mois précédent',
      'attendance.nextMonth': 'Mois suivant',
      'attendance.day': 'Jour',
      'attendance.fillPresent': 'Marquer les restants présents',
      'attendance.filled': { one: '{n} pointage enregistré', other: '{n} pointages enregistrés' },
      'attendance.presentPerDay': 'Présents par jour',
      'attendance.cellLabel': '{name}, {date}',
      'attendance.empty': "Aucune personne pour l'instant. Ajoutez-en dans l'onglet « Personnel ».",
      'attendance.noMatch': 'Aucune personne ne correspond à la recherche.',
      'attendance.fileName': 'pointage',
      'attendance.sheetTitle': 'Feuille de pointage — {month}',

      'people.matriculePlaceholder': 'Matricule',
      'people.namePlaceholder': 'Nom complet *',
      'people.jobTitlePlaceholder': 'Fonction',
      'people.servicePlaceholder': 'Service / Département',
      'people.add': 'Ajouter',
      'people.added': '{name} a été ajouté(e)',
      'people.count': { one: '{n} personne', other: '{n} personnes' },
      'people.confirmDelete': 'Supprimer {name} ainsi que tout son historique de présence ?',
      'people.empty': 'Aucune personne enregistrée.',

      'stats.from': 'Du',
      'stats.to': 'Au',
      'stats.recorded': 'Jours pointés',
      'stats.rate': 'Taux de présence',
      'stats.rateHelp': 'Taux de présence = (présent + en retard) ÷ jours pointés.',
      'stats.total': 'Total',
      'stats.fileName': 'statistiques_presences',
      'stats.title': 'Statistiques de présence',

      'errors.UNAUTHORIZED': 'Votre session a expiré. Veuillez vous reconnecter.',
      'errors.INVALID_CREDENTIALS': 'Identifiant ou mot de passe incorrect.',
      'errors.TOO_MANY_ATTEMPTS': 'Trop de tentatives. Réessayez dans 15 minutes.',
      'errors.NAME_REQUIRED': 'Le nom est obligatoire.',
      'errors.MATRICULE_TAKEN': 'Ce matricule est déjà attribué à une autre personne.',
      'errors.INVALID_DATE': 'Date invalide.',
      'errors.INVALID_MONTH': 'Mois invalide.',
      'errors.INVALID_STATUS': 'Statut invalide.',
      'errors.INVALID_RANGE': 'La date de début doit précéder la date de fin.',
      'errors.INVALID_JSON': 'Requête invalide.',
      'errors.INVALID_EXPORT': 'Impossible de générer le fichier.',
      'errors.NOT_FOUND': 'Élément introuvable.',
      'errors.NETWORK': 'Impossible de joindre le serveur.',
      'errors.SERVER_ERROR': 'Une erreur est survenue sur le serveur.',
    },

    en: {
      'app.title': 'Attendance Manager',
      'app.language': 'Language',

      'login.title': 'Sign in',
      'login.username': 'Username',
      'login.password': 'Password',
      'login.submit': 'Sign in',
      'login.logout': 'Sign out',

      'nav.attendance': 'Attendance',
      'nav.people': 'Staff',
      'nav.stats': 'Statistics',

      'common.matricule': 'Employee ID',
      'common.name': 'Full name',
      'common.jobTitle': 'Job title',
      'common.service': 'Department',
      'common.allServices': 'All departments',
      'common.search': 'Search (name, ID…)',
      'common.edit': 'Edit',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.actions': 'Actions',
      'common.exportPdf': 'Export PDF',
      'common.exportExcel': 'Export Excel',
      'common.countLabel': '{label}: {n}',
      'common.saved': 'Saved',

      'export.generatedAt': 'Generated on {date}',
      'export.page': 'Page {page} of {pages}',
      'export.period': 'Period: {from} to {to}',
      'export.search': 'Search: “{q}”',

      'status.present': 'Present',
      'status.absent': 'Absent',
      'status.late': 'Late',
      'status.excused': 'Excused',

      'statusCode.present': 'P',
      'statusCode.absent': 'A',
      'statusCode.late': 'L',
      'statusCode.excused': 'E',

      'attendance.month': 'Month',
      'attendance.thisMonth': 'This month',
      'attendance.prevMonth': 'Previous month',
      'attendance.nextMonth': 'Next month',
      'attendance.day': 'Day',
      'attendance.fillPresent': 'Mark remaining as present',
      'attendance.filled': { one: '{n} entry saved', other: '{n} entries saved' },
      'attendance.presentPerDay': 'Present per day',
      'attendance.cellLabel': '{name}, {date}',
      'attendance.empty': 'No staff yet. Add some in the “Staff” tab.',
      'attendance.noMatch': 'Nobody matches the search.',
      'attendance.fileName': 'attendance_sheet',
      'attendance.sheetTitle': 'Attendance sheet — {month}',

      'people.matriculePlaceholder': 'Employee ID',
      'people.namePlaceholder': 'Full name *',
      'people.jobTitlePlaceholder': 'Job title',
      'people.servicePlaceholder': 'Department',
      'people.add': 'Add',
      'people.added': '{name} was added',
      'people.count': { one: '{n} person', other: '{n} people' },
      'people.confirmDelete': 'Delete {name} and all of their attendance history?',
      'people.empty': 'No staff registered.',

      'stats.from': 'From',
      'stats.to': 'To',
      'stats.recorded': 'Days recorded',
      'stats.rate': 'Attendance rate',
      'stats.rateHelp': 'Attendance rate = (present + late) ÷ days recorded.',
      'stats.total': 'Total',
      'stats.fileName': 'attendance_statistics',
      'stats.title': 'Attendance statistics',

      'errors.UNAUTHORIZED': 'Your session has expired. Please sign in again.',
      'errors.INVALID_CREDENTIALS': 'Incorrect username or password.',
      'errors.TOO_MANY_ATTEMPTS': 'Too many attempts. Try again in 15 minutes.',
      'errors.NAME_REQUIRED': 'Name is required.',
      'errors.MATRICULE_TAKEN': 'This employee ID is already assigned to someone else.',
      'errors.INVALID_DATE': 'Invalid date.',
      'errors.INVALID_MONTH': 'Invalid month.',
      'errors.INVALID_STATUS': 'Invalid status.',
      'errors.INVALID_RANGE': 'The start date must be before the end date.',
      'errors.INVALID_JSON': 'Invalid request.',
      'errors.INVALID_EXPORT': 'The file could not be generated.',
      'errors.NOT_FOUND': 'Item not found.',
      'errors.NETWORK': 'Unable to reach the server.',
      'errors.SERVER_ERROR': 'Something went wrong on the server.',
    },

    'zh-CN': {
      'app.title': '考勤管理',
      'app.language': '语言',

      'login.title': '登录',
      'login.username': '用户名',
      'login.password': '密码',
      'login.submit': '登录',
      'login.logout': '退出登录',

      'nav.attendance': '考勤登记',
      'nav.people': '员工',
      'nav.stats': '统计',

      'common.matricule': '工号',
      'common.name': '姓名',
      'common.jobTitle': '职位',
      'common.service': '部门',
      'common.allServices': '全部部门',
      'common.search': '搜索（姓名、工号…）',
      'common.edit': '编辑',
      'common.save': '保存',
      'common.cancel': '取消',
      'common.delete': '删除',
      'common.actions': '操作',
      'common.exportPdf': '导出 PDF',
      'common.exportExcel': '导出 Excel',
      'common.countLabel': '{label}：{n}',
      'common.saved': '已保存',

      'export.generatedAt': '生成时间：{date}',
      'export.page': '第 {page} 页，共 {pages} 页',
      'export.period': '统计期间：{from} 至 {to}',
      'export.search': '搜索：“{q}”',

      'status.present': '出勤',
      'status.absent': '缺勤',
      'status.late': '迟到',
      'status.excused': '请假',

      'statusCode.present': '勤',
      'statusCode.absent': '缺',
      'statusCode.late': '迟',
      'statusCode.excused': '假',

      'attendance.month': '月份',
      'attendance.thisMonth': '本月',
      'attendance.prevMonth': '上个月',
      'attendance.nextMonth': '下个月',
      'attendance.day': '日期',
      'attendance.fillPresent': '其余人员标记为出勤',
      'attendance.filled': { other: '已登记 {n} 条记录' },
      'attendance.presentPerDay': '每日出勤人数',
      'attendance.cellLabel': '{name}，{date}',
      'attendance.empty': '暂无员工，请先在“员工”页面添加。',
      'attendance.noMatch': '没有符合搜索条件的员工。',
      'attendance.fileName': '考勤表',
      'attendance.sheetTitle': '{month}考勤表',

      'people.matriculePlaceholder': '工号',
      'people.namePlaceholder': '姓名 *',
      'people.jobTitlePlaceholder': '职位',
      'people.servicePlaceholder': '部门',
      'people.add': '添加',
      'people.added': '已添加 {name}',
      'people.count': { other: '共 {n} 人' },
      'people.confirmDelete': '确定删除 {name} 及其全部考勤记录吗？',
      'people.empty': '暂无员工。',

      'stats.from': '从',
      'stats.to': '至',
      'stats.recorded': '登记天数',
      'stats.rate': '出勤率',
      'stats.rateHelp': '出勤率 =（出勤 + 迟到）÷ 登记天数。',
      'stats.total': '合计',
      'stats.fileName': '考勤统计',
      'stats.title': '考勤统计',

      'errors.UNAUTHORIZED': '登录已过期，请重新登录。',
      'errors.INVALID_CREDENTIALS': '用户名或密码错误。',
      'errors.TOO_MANY_ATTEMPTS': '尝试次数过多，请 15 分钟后再试。',
      'errors.NAME_REQUIRED': '姓名为必填项。',
      'errors.MATRICULE_TAKEN': '该工号已被其他员工使用。',
      'errors.INVALID_DATE': '日期无效。',
      'errors.INVALID_MONTH': '月份无效。',
      'errors.INVALID_STATUS': '考勤状态无效。',
      'errors.INVALID_RANGE': '开始日期不能晚于结束日期。',
      'errors.INVALID_JSON': '请求无效。',
      'errors.INVALID_EXPORT': '无法生成文件。',
      'errors.NOT_FOUND': '未找到该记录。',
      'errors.NETWORK': '无法连接服务器。',
      'errors.SERVER_ERROR': '服务器出错，请稍后再试。',
    },
  };

  function detectLang() {
    try {
      const saved = localStorage.getItem('lang');
      if (LANGS.includes(saved)) return saved;
    } catch {
      // Storage may be unavailable (private mode); fall back to the browser language.
    }
    for (const tag of navigator.languages || [navigator.language || '']) {
      const lower = tag.toLowerCase();
      if (lower.startsWith('zh')) return 'zh-CN';
      if (lower.startsWith('fr')) return 'fr';
      if (lower.startsWith('en')) return 'en';
    }
    return DEFAULT_LANG;
  }

  let lang = detectLang();

  function has(key) {
    return key in MESSAGES[lang] || key in MESSAGES[DEFAULT_LANG];
  }

  // t('people.count', { n: 3 }) → "3 personnes" / "3 people" / "共 3 人"
  function t(key, params = {}) {
    let msg = MESSAGES[lang][key] ?? MESSAGES[DEFAULT_LANG][key] ?? key;
    if (typeof msg === 'object') {
      msg = msg[new Intl.PluralRules(lang).select(params.n ?? 0)] ?? msg.other;
    }
    return msg.replace(/\{(\w+)\}/g, (match, name) => {
      if (!(name in params)) return match;
      const value = params[name];
      return typeof value === 'number' ? new Intl.NumberFormat(lang).format(value) : String(value);
    });
  }

  function apply(root = document) {
    document.documentElement.lang = lang;
    document.title = t('app.title');
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });
  }

  function setLang(next) {
    if (!LANGS.includes(next)) return;
    lang = next;
    try {
      localStorage.setItem('lang', next);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
    apply();
  }

  return {
    LANGS,
    t,
    has,
    apply,
    setLang,
    get lang() {
      return lang;
    },
  };
})();
