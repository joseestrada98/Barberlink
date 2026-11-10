/* Configure these with the public URL and anon key from your Supabase project. */
const SUPABASE_URL = 'https://byhgolgveshqgeqmnrks.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mqRwxk1f7L_M1QYJt3UVEw_qnM4DOYg';
const WEB_PUSH_PUBLIC_KEY = 'BFSsXqTzyESC5k3FCAFSc8Zu4dC95huN2vN_jDxUHxIIG2oLjlfE016hx3IzCnyaF2gjSA2g2mbPAkAvGviGkDE';
const MIN_APPOINTMENT_RESPONSE_SECONDS = 600;
const supabaseReady = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('PEGA_AQUI') && !SUPABASE_ANON_KEY.includes('PEGA_AQUI');
const db = supabaseReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (selector) => document.querySelector(selector);
const dateInBogota = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const timeFormatter = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true });
const NOTIFICATION_SOUND_STORAGE_KEY = 'barberlink-notification-sound-enabled';
const NEW_APPOINTMENT_SOUND_STORAGE_KEY = 'barberlink-new-appointment-sound-enabled';
let selectedTime = null;
let activeView = 'booking';
let appointmentToken = null;
let barberSlug = new URLSearchParams(window.location.search).get('barber');
let adminBarberProfile = null;
let publicStaffList = [];
let teamMembers = [];
let adminStaffId = null;
let adminStaffConfig = null;
let signedInStaffId = null;
let isShopOwner = false;
let isPlatformAdmin = false;
let platformAdminRequested = false;
let platformBarbers = [];
let dashboardChannel = null;
let refreshTimer = null;
let personalRefreshTimer = null;
let scheduleLoadRequest = 0;
const finishFormStates = new Map();
let incomePeriod = 'day';
let incomeLoadRequest = 0;
let calendarLoadRequest = 0;
const dashboardSections = ['requests', 'accepted', 'calendar', 'debts', 'income', 'schedule', 'transfer-settings'];
let transferMethodState = [];
let serviceCatalogState = [];
let publicServiceCatalog = [];
let currentPublicConfig = null;
let profileSaveRequest = 0;
let activeDashboardSection = 'requests';
let staffSlugRoute = new URLSearchParams(window.location.search).get('staff');
let notificationSoundContext = null;
let notificationSoundBuffer = null;
let newAppointmentSoundBuffer = null;
let knownPendingAppointmentIds = null;
let pendingAppointmentSnapshotScope = null;
let calendarWeekStart = null;

function showView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach((section) => section.classList.add('hidden'));
  $(`#${view}-view`).classList.remove('hidden');
  $('#public-error').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function savePublicProfile() {
  const button = $('#save-public-profile');
  const errorElement = $('#transfer-settings-error');
  const values = {
    public_description: $('#public-description').value.trim(),
    public_address: $('#public-address').value.trim(),
    public_phone: $('#public-phone').value.trim(),
    public_maps_url: $('#public-maps-url').value.trim()
  };
  if (values.public_description.length > 1000 || values.public_address.length > 250
    || values.public_phone.length > 30 || values.public_maps_url.length > 1000) {
    showError(errorElement, 'Revisa la longitud máxima de los datos del perfil público.');
    return;
  }
  if (values.public_maps_url) {
    try {
      const mapsUrl = new URL(values.public_maps_url);
      if (mapsUrl.protocol !== 'https:' && mapsUrl.protocol !== 'http:') throw new Error();
    } catch {
      showError(errorElement, 'El enlace de mapas debe ser una URL válida que empiece con http:// o https://.');
      return;
    }
  }
  const requestId = ++profileSaveRequest;
  errorElement.classList.add('hidden');
  button.disabled = true;
  try {
    const { data, error } = await db.from('barber_profiles').update(values)
      .eq('id', adminBarberProfile.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No se guardó el perfil. Verifica que la migración de nuevas funciones esté aplicada y vuelve a iniciar sesión.');
    Object.assign(adminBarberProfile, values);
    if (requestId === profileSaveRequest) {
      if (barberSlug === adminBarberProfile.slug) {
        currentPublicConfig = { ...currentPublicConfig, ...values };
        renderPublicProfile(currentPublicConfig);
      }
      renderQrCode($('#admin-profile-qr'), publicBarberUrl());
      const profileLink = $('#admin-profile-link');
      profileLink.href = publicBarberUrl();
      profileLink.textContent = publicBarberUrl();
      toast('Perfil público actualizado.');
    }
  } catch (error) {
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
  }
}
function showError(element, message) {
  const description = typeof message === 'string' ? message : message?.message || 'Ocurrió un error inesperado.';
  let friendlyMessage = description;
  if (description.includes('invalid input syntax for type uuid') || description.includes("Cannot read properties of null (reading 'id')")) {
    friendlyMessage = 'No se pudo identificar la barbería o el profesional seleccionado. Recarga el panel y vuelve a elegirlo antes de intentar eliminarlo.';
  } else if (description.includes('platform_admin_delete_barbershop') || description.includes('platform_admin_delete_team_member')) {
    friendlyMessage = 'Falta habilitar la eliminación en Supabase. Ejecuta el archivo actualizado supabase-platform-admin-migration.sql completo en Supabase → SQL Editor y vuelve a cargar la página.';
  } else if (description.includes('barber_team_members') || description.includes('current_staff_id') || description.includes('create_barber_team_member') || description.includes('staff_id') || description.includes('p_staff_id')) {
    friendlyMessage = 'Falta activar el equipo de barberos actualizado en Supabase. Ejecuta supabase-team-barbers-migration.sql después de las migraciones existentes.';
  } else if (description.includes('send-delay-notifications') && (description.includes('404') || description.toLowerCase().includes('no encontrada'))) {
    friendlyMessage = 'La función send-delay-notifications no está publicada en el proyecto Supabase vinculado. Desde la raíz del proyecto ejecuta: supabase functions deploy send-delay-notifications. Confirma también que vinculaste el proyecto correcto con supabase link.';
  } else if (description.includes('Failed to send a request to the Edge Function')) {
    friendlyMessage = `No se pudo conectar con la Edge Function. Verifica que esté desplegada en el proyecto correcto y que no haya un problema de red. Detalle: ${description}`;
  } else if (description.includes('Edge Function returned a non-2xx status code')) {
    friendlyMessage = `La Edge Function respondió con error. Revisa su registro en Supabase → Edge Functions → Logs y los secretos requeridos. Detalle: ${description}`;
  } else if (description.includes('transfer_now') || description.includes('transfer_bank_name') || description.includes('transfer_methods') || description.includes('p_transfer_now') || description.includes('transfer_notice_sent_at')) {
    friendlyMessage = 'Falta actualizar las transferencias inmediatas en Supabase. Ejecuta el archivo actualizado supabase-fix-appointment-delay.sql y despliega notify-transfer-request como indica README.md.';
  } else if (description.includes('payment_status') || description.includes('debt_amount') || description.includes('amount_charged') || description.includes('completed_at') || description.includes('complete_barber_appointment') || description.includes('settle_barber_debt') || description.includes('clear_barber_income_period')) {
    friendlyMessage = 'Falta actualizar pagos, precios y deudas en Supabase. Ejecuta el archivo actualizado supabase-fix-appointment-delay.sql completo y vuelve a cargar la página.';
  } else if (description.includes('transfer_verification_status') || description.includes('set_barber_transfer_verification')) {
    friendlyMessage = 'Falta activar la verificación de transferencias en Supabase. Ejecuta el archivo actualizado supabase-fix-appointment-delay.sql completo y vuelve a cargar la página.';
  } else if (description.includes('slot_minutes')) {
    friendlyMessage = 'Falta habilitar este intervalo en Supabase. Ejecuta supabase-next-features.sql y vuelve a cargar la página.';
  } else if (description.includes('service_catalog') || description.includes('requested_services') || description.includes('p_service_ids')) {
    friendlyMessage = 'Falta actualizar servicios y precios en Supabase. Ejecuta el archivo actualizado supabase-fix-appointment-delay.sql completo y vuelve a cargar la página.';
  } else if (description.includes('register_appointment_push') || description.includes('appointment_push_subscriptions')) {
    friendlyMessage = 'Falta activar las suscripciones push en Supabase. Vuelve a ejecutar supabase-fix-appointment-delay.sql.';
  } else if (description.includes('claim_appointment_notification') || description.includes('appointment_notification_events')) {
    friendlyMessage = 'Falta activar los avisos de aceptación y verificación. Ejecuta supabase-appointment-notifications.sql en Supabase → SQL Editor.';
  } else if (description.includes('set_appointment_reminder_consent') || description.includes('claim_due_appointment_reminders') || description.includes('appointment_reminder_deliveries') || description.includes('public_barber_reviews') || description.includes('public_description')) {
    friendlyMessage = 'Faltan las nuevas funciones de agenda pública. Ejecuta supabase-next-features.sql en Supabase → SQL Editor y vuelve a cargar la página.';
  } else if (description.includes('set_barber_delay') || description.includes('delay_minutes')) {
    friendlyMessage = 'Falta activar los avisos de retraso en Supabase. Ejecuta supabase-fix-appointment-delay.sql y vuelve a intentarlo.';
  } else if (description.includes('schema cache') || description.includes('Could not find the function') || description.includes('work_hour_overrides')) {
    friendlyMessage = 'Falta aplicar o completar la migración de varias barberías en Supabase. Revisa supabase-multibarber-migration.sql.';
  } else if (description.includes('row-level security') || description.includes('permission denied') || description.includes('42501')) {
    friendlyMessage = 'Supabase no autorizó el cambio. Verifica que esta cuenta esté asociada a la barbería y vuelve a iniciar sesión. El administrador puede gestionar las asociaciones desde el menú → Administrar barberías.';
  }
  if (!element) {
    console.error('No se encontró el elemento para mostrar este error:', friendlyMessage);
    toast(friendlyMessage);
    return;
  }
  element.textContent = friendlyMessage;
  element.classList.remove('hidden');
}
function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
async function getEdgeFunctionErrorMessage(error, functionName) {
  const response = error?.context;
  if (response instanceof Response) {
    if (response.status === 404) {
      return `${functionName}: función no encontrada (404). Despliégala en el proyecto Supabase vinculado y confirma que la URL de app.js corresponde a ese proyecto.`;
    }

    let responseText = '';
    try {
      responseText = await response.clone().text();
    } catch (readError) {
      console.error(`No se pudo leer la respuesta de ${functionName}:`, readError);
    }
    let detail = responseText;
    if (responseText) {
      try {
        const body = JSON.parse(responseText);
        detail = body.error || body.message || body.msg || responseText;
      } catch {
        detail = responseText;
      }
    }
    return `${functionName} respondió HTTP ${response.status}${detail ? `: ${detail}` : '.'}`;
  }
  return `${functionName}: ${error?.message || 'falló la solicitud sin una respuesta HTTP'}. Verifica que la función esté desplegada en el mismo proyecto y revisa sus Logs en Supabase.`;
}
function selectedPlatformBarberId() {
  const barberId = $('#platform-admin-barber').value;
  return isUuid(barberId) ? barberId : null;
}
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.remove('hidden');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.add('hidden'), 3200);
}
function formatTime(value) {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  return timeFormatter.format(new Date(Date.UTC(2020, 0, 1, hours + 5, minutes)));
}
function requireConnection() {
  if (!db) throw new Error('Falta conectar Supabase. Sigue la guía de instalación en README.md.');
}
function setBookingClosed(isClosed) {
  $('#closed-message').classList.toggle('hidden', !isClosed);
  $('#booking-card').classList.toggle('hidden', isClosed);
}
function setBookingServicesForStaff() {
  const selectedStaff = publicStaffList.find((staff) => staff.id === $('#booking-staff').value);
  publicServiceCatalog = Array.isArray(selectedStaff?.services) ? selectedStaff.services : [];
}
function publicBarberUrl() {
  const url = new URL('./', window.location.href);
  url.search = '';
  url.searchParams.set('barber', adminBarberProfile?.slug || barberSlug);
  return url.href;
}
function renderQrCode(container, value) {
  container.replaceChildren();
  if (typeof window.QRCode !== 'function') {
    container.textContent = 'No se pudo cargar el generador del código QR.';
    return null;
  }
  try {
    new window.QRCode(container, {
      text: value,
      width: 176,
      height: 176,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
    return container.querySelector('canvas');
  } catch (error) {
    container.textContent = 'No se pudo generar el código QR.';
    console.error('No se pudo generar el código QR:', error);
    return null;
  }
}
function downloadPublicProfileQr() {
  const button = $('#download-profile-qr');
  if (typeof window.QRCode !== 'function') {
    showError($('#transfer-settings-error'), 'No se pudo cargar el generador del código QR. Recarga la página e inténtalo de nuevo.');
    return;
  }
  button.disabled = true;
  const temporary = document.createElement('div');
  temporary.className = 'qr-download-source';
  document.body.append(temporary);
  try {
    new window.QRCode(temporary, {
      text: publicBarberUrl(),
      width: 512,
      height: 512,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H
    });
    const qrImage = temporary.querySelector('canvas, img');
    const dataUrl = qrImage?.tagName === 'CANVAS'
      ? qrImage.toDataURL('image/png')
      : qrImage?.src;
    button.disabled = false;
    if (!dataUrl) {
      showError($('#transfer-settings-error'), 'No se pudo crear el QR descargable en este navegador.');
      return;
    }
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${adminBarberProfile.slug}-qr.png`;
    link.click();
  } catch (error) {
    button.disabled = false;
    showError($('#transfer-settings-error'), `No se pudo crear el QR: ${error.message}`);
  } finally {
    temporary.remove();
  }
}
function renderPublicProfile(config) {
  const container = $('#barber-public-profile');
  const isExpanded = container.querySelector('#toggle-public-profile')?.getAttribute('aria-expanded') === 'true';
  container.classList.remove('hidden');
  const phone = String(config.public_phone || '').trim();
  const address = String(config.public_address || '').trim();
  const description = String(config.public_description || '').trim();
  let mapsLink = '';
  if (config.public_maps_url) {
    try {
      const url = new URL(config.public_maps_url);
      if (url.protocol === 'https:' || url.protocol === 'http:') mapsLink = url.href;
    } catch (error) {
      console.error('El enlace de mapas del perfil no es válido:', error);
    }
  }
  const profileUrl = new URL('./', window.location.href);
  profileUrl.search = '';
  profileUrl.searchParams.set('barber', barberSlug);
  container.innerHTML = `
    <button id="toggle-public-profile" class="public-profile-toggle" type="button" aria-expanded="${isExpanded}" aria-controls="public-profile-details">
      <span>Información de ${escapeHtml(config.barber_name || 'la barbería')}</span><span class="public-profile-toggle-icon" aria-hidden="true">${isExpanded ? '−' : '+'}</span>
    </button>
    <div id="public-profile-details" class="public-profile-details${isExpanded ? '' : ' hidden'}">
      ${description ? `<p class="public-profile-description">${escapeHtml(description)}</p>` : ''}
      ${address ? `<p class="public-profile-detail"><strong>Dirección</strong><span>${escapeHtml(address)}</span></p>` : ''}
      ${phone ? `<p class="public-profile-detail"><strong>Número de contacto</strong><a href="tel:${encodeURIComponent(phone)}">${escapeHtml(phone)}</a></p>` : ''}
      ${mapsLink ? `<p class="public-profile-detail"><strong>Ubicación</strong><a href="${escapeHtml(mapsLink)}" target="_blank" rel="noopener noreferrer">Cómo llegar en Google Maps</a></p>` : ''}
      <div class="public-booking-link"><strong>Enlace para pedir cita</strong><a id="public-booking-link" href="${escapeHtml(profileUrl.href)}">${escapeHtml(profileUrl.href)}</a></div>
      <section class="public-reviews">
        <div class="profile-rating"><strong id="public-rating-average">—</strong><span id="public-rating-count">Cargando reseñas…</span></div>
        <div id="public-review-list" class="public-review-list"></div>
      </section>
      <div class="public-qr-row"><div id="public-profile-qr" class="profile-qr"></div><span>Escanea para abrir esta barbería y pedir una cita.</span></div>
    </div>`;
  $('#toggle-public-profile').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    button.querySelector('.public-profile-toggle-icon').textContent = expanded ? '−' : '+';
    $('#public-profile-details').classList.toggle('hidden', !expanded);
  });
  renderQrCode($('#public-profile-qr'), profileUrl.href);
  loadPublicReviews(barberSlug).catch((error) => showError($('#public-error'), error.message));
}
async function loadPublicReviews(slug) {
  const { data, error } = await db.rpc('public_barber_reviews', { p_slug: slug });
  if (error) throw error;
  const summary = Array.isArray(data) ? data[0] : data;
  const reviews = Array.isArray(summary?.reviews) ? summary.reviews : [];
  const averageElement = $('#public-rating-average');
  const countElement = $('#public-rating-count');
  const list = $('#public-review-list');
  if (!averageElement || !countElement || !list) return;
  averageElement.textContent = summary?.average == null ? '—' : `${Number(summary.average).toFixed(1)} ★`;
  countElement.textContent = `${Number(summary?.count) || 0} ${Number(summary?.count) === 1 ? 'reseña' : 'reseñas'}`;
  list.replaceChildren();
  if (!reviews.length) {
    const empty = document.createElement('p');
    empty.className = 'form-note';
    empty.textContent = 'Todavía no hay reseñas.';
    list.append(empty);
    return;
  }
  reviews.forEach((review) => {
    const article = document.createElement('article');
    article.className = 'public-review';
    const heading = document.createElement('strong');
    heading.textContent = `${review.name || 'Cliente'} · ${'★'.repeat(Number(review.rating) || 0)}`;
    article.append(heading);
    if (review.comment) {
      const comment = document.createElement('p');
      comment.textContent = review.comment;
      article.append(comment);
    }
    list.append(article);
  });
}
async function loadPublicConfig() {
  if (!db || !barberSlug) return;
  const { data, error } = await db.rpc('public_booking_config', { barber_slug: barberSlug });
  if (error) throw error;
  const config = Array.isArray(data) ? data[0] : data;
  if (!config) throw new Error('No encontramos esta barbería. Vuelve al directorio y elige una barbería disponible.');
  if (!Array.isArray(config.services)) throw new Error('Falta habilitar el catálogo de servicios (service_catalog) en Supabase.');
  if (!Array.isArray(config.staff) || !config.staff.some((staff) => staff.is_active)) {
    throw new Error('Esta barbería todavía no tiene barberos activos para recibir reservas.');
  }
  currentPublicConfig = config;
  publicStaffList = Array.isArray(config.staff) ? config.staff.filter((staff) => staff.is_active) : [];
  const select = $('#booking-staff');
  renderBookingStaff();
  setBookingServicesForStaff();
  renderBookingServices();
  setBookingClosed(!config?.is_open);
  renderPublicProfile(config);
  if (config?.barber_name) {
    $('#brand-name').textContent = config.barber_name.toLocaleUpperCase('es-CO');
    $('#booking-title').textContent = config.barber_name;
    document.title = `${config.barber_name} — Agenda tu cita`;
  }
  function renderBookingStaff() {
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona un barbero';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    publicStaffList.forEach((staff) => {
      const option = document.createElement('option');
      option.value = staff.id;
      option.textContent = staff.name;
      select.append(option);
    });
  }
  select.value = '';
  staffSlugRoute = null;
}
function setBarberRoute(slug) {
  barberSlug = slug;
  staffSlugRoute = null;
  updateBookingEntry();
  const url = new URL('./', window.location.href);
  if (slug) url.searchParams.set('barber', slug);
  history.pushState({}, '', url);
}
function updateBookingEntry() {
  $('#booking-entry').classList.toggle('hidden', !barberSlug && !adminBarberProfile?.slug);
}
function openPersonalAppointment() {
  if (!appointmentToken) return;
  closeTopbarMenu();
  const url = new URL('./', window.location.href);
  if (barberSlug) url.searchParams.set('barber', barberSlug);
  url.searchParams.set('cita', appointmentToken);
  history.pushState({}, '', url);
  showView('appointment');
  loadPersonalAppointment();
  connectAppointmentLive();
}
function closeTopbarMenu() {
  $('#topbar-menu').classList.add('hidden');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
  $('#menu-toggle').setAttribute('aria-label', 'Abrir menú');
}
function toggleTopbarMenu() {
  const isOpen = !$('#topbar-menu').classList.contains('hidden');
  $('#topbar-menu').classList.toggle('hidden', isOpen);
  $('#menu-toggle').setAttribute('aria-expanded', String(!isOpen));
  $('#menu-toggle').setAttribute('aria-label', isOpen ? 'Abrir menú' : 'Cerrar menú');
}
function shiftDate(date, days) {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
function formatBookingDate(date) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date(`${date}T12:00:00Z`));
}
async function findNextAvailableDate(date) {
  const staffId = $('#booking-staff').value;
  if (!staffId) return null;
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidateDate = shiftDate(date, offset);
    const { data, error } = await db.rpc('public_available_slots', {
      barber_slug: barberSlug,
      p_staff_id: staffId,
      requested_date: candidateDate
    });
    if (error) throw error;
    if (data?.length) return candidateDate;
  }
  return null;
}
async function loadBarberDirectory() {
  try {
    requireConnection();
    const { data, error } = await db.rpc('public_barber_directory');
    if (error) throw error;
    const container = $('#barber-directory');
    container.replaceChildren();
    if (!data?.length) {
      container.innerHTML = '<div class="empty-list">Todavía no hay barberías publicadas.</div>';
      return;
    }
    data.forEach((barber) => {
      const card = document.createElement('a');
      card.className = 'barber-card';
      card.href = `?barber=${encodeURIComponent(barber.slug)}`;
      const icon = document.createElement('span');
      icon.className = 'barber-card-mark';
      icon.textContent = barber.barber_name.trim().charAt(0).toLocaleUpperCase('es-CO');
      const details = document.createElement('span');
      details.className = 'barber-card-details';
      const name = document.createElement('strong');
      name.textContent = barber.barber_name;
      const status = document.createElement('span');
      status.className = barber.is_open ? 'barber-open' : 'barber-closed';
      const rating = Number(barber.review_count) > 0
        ? ` · ${Number(barber.average_rating).toFixed(1)} ★ (${barber.review_count})`
        : '';
      status.textContent = `${barber.is_open ? 'Recibiendo citas' : 'Agenda cerrada'}${rating}`;
      details.append(name, status);
      const arrow = document.createElement('span');
      arrow.className = 'barber-card-arrow';
      arrow.textContent = '→';
      card.append(icon, details, arrow);
      container.append(card);
    });
  } catch (error) {
    $('#barber-directory').innerHTML = '<div class="empty-list">No se pudo cargar el directorio.</div>';
    showError($('#directory-error'), error.message);
  }
}
async function loadSlots() {
  const date = $('#appointment-date').value;
  selectedTime = null;
  $('#booking-form-wrap').classList.add('hidden');
  $('#slots').replaceChildren();
  if (!date) return;
  if (!$('#booking-staff').value) {
    $('#slot-help').textContent = 'Elige un barbero para consultar sus horarios';
    return;
  }
  $('#slot-help').textContent = 'Buscando espacios…';
  try {
    requireConnection();
    const { data, error } = await db.rpc('public_available_slots', {
      barber_slug: barberSlug,
      p_staff_id: $('#booking-staff').value,
      requested_date: date
    });
    if (error) throw error;
    $('#slots').replaceChildren();
    const availableTimes = (data || []).map((slot) => typeof slot === 'string' ? slot : slot?.available_time);
    if (availableTimes.some((time) => typeof time !== 'string')) {
      throw new Error('Supabase devolvió los horarios en un formato inesperado.');
    }
    if (!availableTimes.length) {
      $('#slot-help').textContent = 'No hay horarios para esta fecha';
      const nextDate = await findNextAvailableDate(date);
      if (!nextDate) {
        $('#slots').innerHTML = '<div class="empty-slots">No hay horarios disponibles en los próximos siete días. Elige otra fecha o consulta más tarde.</div>';
        return;
      }
      const message = document.createElement('div');
      message.className = 'empty-slots';
      message.append(`No quedan horas para esta fecha. Próxima disponibilidad: ${formatBookingDate(nextDate)}. `);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'next-date-button';
      button.textContent = 'Ver horas disponibles';
      button.addEventListener('click', () => {
        $('#appointment-date').value = nextDate;
        loadSlots();
      });
      message.append(button);
      $('#slots').append(message);
      return;
    }
    $('#slot-help').textContent = `${availableTimes.length} ${availableTimes.length === 1 ? 'hora disponible' : 'horas disponibles'}`;
    availableTimes.forEach((time) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot-button';
      button.textContent = formatTime(time);
      button.addEventListener('click', () => {
        selectedTime = time;
        document.querySelectorAll('.slot-button').forEach((slot) => slot.classList.remove('selected'));
        button.classList.add('selected');
        $('#selected-slot-label').textContent = `${date} · ${formatTime(time)}`;
        $('#booking-form-wrap').classList.remove('hidden');
        $('#customer-name').focus({ preventScroll: true });
      });
      $('#slots').append(button);
    });
  } catch (error) {
    $('#slot-help').textContent = 'No fue posible cargar los horarios';
    showError($('#public-error'), error.message);
  }
}
function renderBookingResult(appointment, notificationsEnabled, pushMessage) {
  const personalUrl = new URL('./', window.location.href);
  personalUrl.searchParams.set('barber', barberSlug);
  personalUrl.searchParams.set('staff', $('#booking-staff').value);
  personalUrl.searchParams.set('cita', appointment.access_token);
  const selectedStaff = publicStaffList.find((staff) => staff.id === $('#booking-staff').value);
  appointmentToken = appointment.access_token;
  $('#personal-appointment-entry').classList.remove('hidden');
  const notificationMessage = notificationsEnabled
    ? `Aceptaste recibir avisos por correo.${pushMessage ? ` ${escapeHtml(pushMessage)}` : ' Cuando el barbero acepte, recibirás un aviso push. Puedes dejar esta ventana en segundo plano y mantener activadas las notificaciones para enterarte.'}`
    : 'Elegiste no recibir avisos automáticos. Consulta los cambios desde tu enlace personal.';
  $('#appointment-result').innerHTML = `
    <div class="success-card">
      <h3>Solicitud enviada</h3>
      <p>Solicitaste una cita con ${escapeHtml(selectedStaff?.name || 'tu barbero')}. Tu espacio está reservado temporalmente mientras responde. Guarda este enlace para consultar el estado.</p>
      <a class="personal-link" href="${personalUrl.href}">${personalUrl.href}</a>
      <p id="booking-notification-message" class="form-note">${notificationMessage}</p>
      <button id="retry-push-registration" class="quiet-button full-button hidden" type="button">Reintentar notificaciones push</button>
      <p style="margin-top:13px;margin-bottom:0">Tu enlace es personal. No lo compartas con otras personas.</p>
    </div>`;
  $('#retry-push-registration').addEventListener('click', retryAppointmentPush);
  $('#appointment-result').classList.remove('hidden');
  $('#booking-form').reset();
  $('#notification-sound-enabled').checked = localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY) === 'true';
  renderBookingServiceTotal();
  updateTransferTimingVisibility();
  $('#booking-form-wrap').classList.add('hidden');
  $('#slots').replaceChildren();
  $('#slot-help').textContent = 'Solicitud registrada';
  $('#appointment-date').value = dateInBogota();
  $('#appointment-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function selectedBookingServices() {
  const selectedIds = new Set([...$('#booking-services').querySelectorAll('input:checked')].map((input) => input.value));
  return publicServiceCatalog.filter((service) => selectedIds.has(service.id));
}
function renderBookingServiceTotal() {
  const selected = selectedBookingServices();
  const total = $('#booking-service-total');
  total.textContent = selected.length
    ? `Total estimado: ${formatCurrency(selected.reduce((sum, service) => sum + Number(service.price), 0))}`
    : '';
  total.classList.toggle('hidden', selected.length === 0);
}
function renderBookingServices() {
  const container = $('#booking-services');
  if (!container) return;
  container.replaceChildren();
  const help = $('#booking-services-help');
  if (!$('#booking-staff').value) {
    help.textContent = 'Primero selecciona un barbero para ver sus servicios y precios.';
    $('#submit-booking').disabled = true;
    return;
  }
  if (!publicServiceCatalog.length) {
    help.textContent = 'Esta barbería todavía no publicó servicios. Comunícate con el barbero para solicitar una cita.';
    $('#submit-booking').disabled = true;
    return;
  }
  help.textContent = 'Selecciona uno o varios servicios. El barbero confirmará el total al finalizar la cita.';
  $('#submit-booking').disabled = false;
  publicServiceCatalog.forEach((service) => {
    const label = document.createElement('label');
    label.className = 'booking-service-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = service.id;
    checkbox.addEventListener('change', renderBookingServiceTotal);
    const details = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = service.name;
    const price = document.createElement('span');
    price.textContent = formatCurrency(Number(service.price));
    details.append(name, price);
    label.append(checkbox, details);
    container.append(label);
  });
}
function updateTransferTimingVisibility() {
  const isTransfer = $('#payment-method').value === 'transfer';
  const timingWrap = $('#transfer-timing-wrap');
  const timingSelect = $('#transfer-timing');
  timingWrap.classList.toggle('hidden', !isTransfer);
  timingSelect.required = isTransfer;
  if (!isTransfer) timingSelect.value = '';
}
function transferDetailsMarkup(appointment) {
  const methods = Array.isArray(appointment.transfer_methods) ? appointment.transfer_methods : [];
  if (!methods.length) return '<p class="form-note">El barbero todavía no ha configurado medios de transferencia. Conserva tu enlace personal para consultar los datos cuando estén disponibles.</p>';
  return methods.map((method) => {
    const name = method.label || ({ bank: 'Cuenta bancaria', nequi: 'Nequi', daviplata: 'Daviplata', other: 'Otro medio' })[method.type] || 'Transferencia';
    const details = [
      method.account_type && ['Tipo de cuenta', method.account_type],
      method.account_number && ['Número', method.account_number],
      method.holder && ['Titular', method.holder],
      method.document && ['Documento', method.document]
    ].filter(Boolean);
    return `<article class="transfer-method-view"><strong>${escapeHtml(name)}</strong>${details.map(([label, value]) => `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</article>`;
  }).join('');
}
async function showTransferDetails(appointment, emailNotice) {
  const { data, error } = await db.rpc('public_appointment_by_token', { token: appointment.access_token });
  if (error) throw error;
  const savedAppointment = Array.isArray(data) ? data[0] : data;
  if (!savedAppointment) throw new Error('No pudimos cargar los datos de transferencia. Consulta tu cita desde el enlace personal.');
  const personalUrl = new URL('./', window.location.href);
  personalUrl.searchParams.set('barber', barberSlug);
  personalUrl.searchParams.set('staff', $('#booking-staff').value);
  personalUrl.searchParams.set('cita', appointment.access_token);
  $('#transfer-dialog-details').innerHTML = transferDetailsMarkup(savedAppointment);
  $('#transfer-dialog-appointment-link').href = personalUrl.href;
  const note = $('#transfer-dialog-note');
  note.textContent = emailNotice;
  note.classList.toggle('hidden', !emailNotice);
  $('#transfer-details-dialog').showModal();
}
async function submitBooking(event) {
  event.preventDefault();
  const button = $('#submit-booking');
  const name = $('#customer-name').value.trim();
  const phone = $('#customer-phone').value.trim();
  const email = $('#customer-email').value.trim();
  const notificationsEnabled = $('#notification-consent').checked;
  const reminderEmailConsent = $('#reminder-email-consent').checked;
  const paymentMethod = $('#payment-method').value;
  const transferNow = paymentMethod === 'transfer' && $('#transfer-timing').value === 'now';
  if (!$('#booking-staff').value) {
    showError($('#public-error'), 'Selecciona el barbero con quien quieres reservar.');
    $('#booking-staff').focus();
    return;
  }
  if (!selectedTime || !name || !phone || !email) return;
  const selectedServices = selectedBookingServices();
  if (!selectedServices.length) {
    showError($('#public-error'), 'Selecciona al menos un servicio antes de solicitar la cita.');
    $('#booking-services').querySelector('input')?.focus();
    return;
  }
  if (paymentMethod === 'transfer' && !$('#transfer-timing').value) {
    $('#transfer-timing').reportValidity();
    return;
  }
  button.disabled = true;
  button.textContent = 'Enviando solicitud…';
  try {
    requireConnection();
    const pushPreparation = notificationsEnabled
      ? prepareAppointmentPush()
      : Promise.resolve({ subscription: null, message: '' });
    const { data, error } = await db.rpc('request_appointment', {
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      requested_date: $('#appointment-date').value,
      requested_time: selectedTime,
      payment_method: paymentMethod,
      barber_slug: barberSlug,
      p_staff_id: $('#booking-staff').value,
      p_notifications_enabled: notificationsEnabled,
      p_transfer_now: transferNow,
      p_service_ids: selectedServices.map((service) => service.id)
    });
    if (error) throw error;
    const appointment = Array.isArray(data) ? data[0] : data;
    if (!appointment?.access_token) throw new Error('No se pudo crear el enlace de tu cita. Intenta de nuevo.');
    renderBookingResult(
      appointment,
      notificationsEnabled,
      notificationsEnabled ? 'Revisando el permiso de notificaciones de este dispositivo…' : ''
    );
    try {
      const { data: consentSaved, error: consentError } = await db.rpc('set_appointment_reminder_consent', {
        p_token: appointment.access_token,
        p_email_enabled: reminderEmailConsent,
        p_push_enabled: notificationsEnabled
      });
      if (consentError) throw consentError;
      if (!consentSaved) throw new Error('Supabase no confirmó el consentimiento para los recordatorios.');
    } catch (consentError) {
      console.error('No se pudieron guardar las preferencias iniciales de recordatorios:', consentError);
      showError($('#public-error'), `La cita sí quedó registrada, pero no se guardaron las preferencias de recordatorios. Puedes configurarlas desde tu enlace personal. ${consentError.message}`);
    }
    const pushState = await pushPreparation;
    let pushMessage = pushState.message;
    if (pushState.subscription) {
      try {
        await registerAppointmentPush(appointment.access_token, pushState.subscription);
        pushMessage = '';
      } catch (error) {
        pushMessage = `No se pudo activar push (${error.message}). Recibirás los avisos por correo.`;
      }
    }
    if (notificationsEnabled) {
      const notificationMessage = $('#booking-notification-message');
      const retryButton = $('#retry-push-registration');
      if (notificationMessage && retryButton) {
        notificationMessage.textContent = pushMessage
          ? `Aceptaste recibir avisos por correo. ${pushMessage}`
          : 'Aceptaste recibir avisos por correo. También recibirás avisos push en este dispositivo.';
        retryButton.classList.toggle('hidden', !pushMessage);
      } else {
        console.error('No se encontraron los controles de notificación de la solicitud para actualizar su estado.');
      }
    }
    if (transferNow) {
      let emailNotice = '';
      try {
        const { error: notificationError } = await db.functions.invoke('notify-transfer-request', {
          body: { access_token: appointment.access_token }
        });
        if (notificationError) throw notificationError;
        emailNotice = 'El barbero recibió un correo para revisar tu solicitud de transferencia.';
      } catch (notificationError) {
        console.error('No se pudo enviar el aviso de transferencia al barbero:', notificationError);
        emailNotice = 'No se pudo enviar el correo al barbero; tu solicitud sí quedó registrada y aparecerá en su panel. Conserva el enlace de tu cita.';
      }
      try {
        await showTransferDetails(appointment, emailNotice);
      } catch (detailsError) {
        showError($('#public-error'), detailsError.message);
      }
    }
  } catch (error) {
    showError($('#public-error'), error.message);
    await loadSlots();
  } finally {
    button.disabled = false;
    button.innerHTML = 'Solicitar cita <span>→</span>';
  }
}
function setDashboardSection(section) {
  if (!dashboardSections.includes(section)) return;
  activeDashboardSection = section;
  document.querySelectorAll('.dashboard-nav [data-dashboard-section]').forEach((button) => {
    const selected = button.dataset.dashboardSection === section;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  document.querySelectorAll('.dashboard-section').forEach((panel) => panel.classList.add('hidden'));
  $(`#dashboard-${section}`).classList.remove('hidden');
  if (section === 'schedule') loadScheduleEditor();
  if (section === 'income') loadIncomeSummary();
  if (section === 'calendar') loadCalendarWeek();
  closeTopbarMenu();
}
function statusName(status) {
  return ({ pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', cancelled: 'Cancelada', attended: 'Atendida', no_show: 'No asistió' })[status] || status;
}
function renderPersonalAppointment(appointment) {
  const preservedValues = {
    emailReminder: $('#appointment-reminder-email')?.checked,
    pushReminder: $('#appointment-reminder-push')?.checked,
    rating: $('#appointment-review-rating')?.value,
    review: $('#appointment-review-comment')?.value
  };
  const statusClass = appointment.status === 'pending' ? 'pending' : ['rejected', 'cancelled'].includes(appointment.status) ? 'rejected' : 'accepted';
  const expiry = appointment.status === 'pending' && appointment.expires_at ? `<p class="form-note">El barbero tiene hasta ${new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' }).format(new Date(appointment.expires_at))} para responder.</p>` : '';
  const delayNotice = appointment.status === 'accepted' && appointment.delay_minutes
    ? `<div class="delay-notice" role="status"><strong>Aviso del barbero</strong><span>Tu cita presenta un retraso aproximado de ${appointment.delay_minutes} minutos. Gracias por tu comprensión.</span></div>`
    : '';
  const requestedServices = appointmentServicesMarkup(
    appointment.requested_services,
    appointment.quoted_amount,
    appointment.amount_charged
  );
  $('#appointment-details').innerHTML = `
    <span class="status-pill ${statusClass}">${statusName(appointment.status)}</span>
    ${delayNotice}
    <div class="detail-grid">
      <div class="detail-item"><span>DÍA</span><strong>${appointment.appointment_date}</strong></div>
      <div class="detail-item"><span>HORA · COLOMBIA</span><strong>${formatTime(appointment.appointment_time)}</strong></div>
      <div class="detail-item"><span>NOMBRE</span><strong>${escapeHtml(appointment.customer_name)}</strong></div>
      <div class="detail-item"><span>MÉTODO DE PAGO</span><strong>${appointment.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}</strong></div>
    </div>
    ${requestedServices}
    ${appointment.payment_method === 'transfer' && appointment.transfer_now
      ? `<section class="transfer-details-section"><h3>Datos para transferir</h3>${transferDetailsMarkup(appointment)}<p class="form-note">El barbero fue avisado para revisar tu solicitud y verificar la transferencia.</p></section>`
      : ''}
    ${appointment.payment_method === 'transfer' && appointment.status === 'accepted'
      ? `<div class="transfer-verification-status ${appointment.transfer_verification_status || 'pending'}" role="status"><strong>${transferVerificationLabel(appointment.transfer_verification_status)}</strong><span>${transferVerificationMessage(appointment.transfer_verification_status)}</span></div>`
      : ''}
    ${appointment.rejection_reason ? `<p class="muted">Motivo: ${escapeHtml(appointment.rejection_reason)}</p>` : ''}
    ${expiry}
    ${['pending', 'accepted'].includes(appointment.status) ? `
      <section class="appointment-reminder-settings">
        <h3>Recordatorios de tu cita</h3>
        <label class="notification-consent" for="appointment-reminder-email">
          <input id="appointment-reminder-email" type="checkbox" ${appointment.reminder_email_consent ? 'checked' : ''}>
          <span>Enviar recordatorios por correo 24 horas y 2 horas antes.</span>
        </label>
        <label class="notification-consent" for="appointment-reminder-push">
          <input id="appointment-reminder-push" type="checkbox" ${appointment.reminder_push_consent ? 'checked' : ''}>
          <span>Enviar recordatorios push a este dispositivo si está suscrito.</span>
        </label>
        <button id="save-appointment-reminders" class="quiet-button full-button" type="button">Guardar preferencias</button>
      </section>` : ''}
    ${appointment.status === 'accepted' ? '<section id="personal-reschedule-offers" class="personal-reschedule-offers"><h3>Horarios propuestos por la barbería</h3><div class="loading-state">Buscando opciones…</div></section>' : ''}
    ${appointment.status === 'attended' && !appointment.review_submitted ? `
      <form id="appointment-review-form" class="appointment-review-form">
        <h3>Cuéntanos cómo te fue</h3>
        <label class="field-label" for="appointment-review-rating">Calificación</label>
        <select id="appointment-review-rating" required>
          <option value="">Elige una calificación</option>
          <option value="5">5 — Excelente</option>
          <option value="4">4 — Muy bien</option>
          <option value="3">3 — Bien</option>
          <option value="2">2 — Regular</option>
          <option value="1">1 — Mala experiencia</option>
        </select>
        <label class="field-label" for="appointment-review-comment">Comentario (opcional)</label>
        <textarea id="appointment-review-comment" maxlength="1000" rows="3" placeholder="Comparte tu experiencia"></textarea>
        <button class="primary-button full-button" type="submit">Enviar reseña</button>
      </form>` : appointment.status === 'attended' ? '<p class="form-note">Ya recibimos tu reseña. ¡Gracias por compartir tu experiencia!</p>' : ''}
    ${appointment.status === 'pending' || appointment.status === 'accepted' ? '<button id="cancel-appointment" class="reject-button" type="button">Cancelar mi cita</button>' : ''}
    <p class="form-note">El estado se actualiza automáticamente en esta página.</p>`;
  if ($('#appointment-reminder-email')) $('#appointment-reminder-email').checked = preservedValues.emailReminder ?? Boolean(appointment.reminder_email_consent);
  if ($('#appointment-reminder-push')) $('#appointment-reminder-push').checked = preservedValues.pushReminder ?? Boolean(appointment.reminder_push_consent);
  if ($('#appointment-review-rating')) $('#appointment-review-rating').value = preservedValues.rating || '';
  if ($('#appointment-review-comment')) $('#appointment-review-comment').value = preservedValues.review || '';
  $('#cancel-appointment')?.addEventListener('click', cancelPersonalAppointment);
  $('#save-appointment-reminders')?.addEventListener('click', saveAppointmentReminderConsent);
  $('#appointment-review-form')?.addEventListener('submit', submitAppointmentReview);
}
async function loadPersonalRescheduleOffers() {
  const container = $('#personal-reschedule-offers');
  if (!container) return;
  const { data, error } = await db.rpc('list_appointment_reschedule_offers', { p_token: appointmentToken });
  if (error) throw error;
  container.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = 'Horarios propuestos por la barbería';
  container.append(heading);
  if (!data?.length) {
    const empty = document.createElement('p');
    empty.className = 'form-note';
    empty.textContent = 'No hay horarios propuestos en este momento.';
    container.append(empty);
    return;
  }
  data.forEach((offer) => {
    const row = document.createElement('article');
    row.className = 'reschedule-offer';
    const detail = document.createElement('span');
    detail.textContent = `${formatBookingDate(offer.offered_date)} · ${formatTime(offer.offered_time)}`;
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'accept-button';
    accept.textContent = 'Elegir este horario';
    accept.addEventListener('click', () => acceptPersonalRescheduleOffer(offer.offer_id, accept));
    row.append(detail, accept);
    container.append(row);
  });
}
async function acceptPersonalRescheduleOffer(offerId, button) {
  button.disabled = true;
  try {
    const { error } = await db.rpc('accept_appointment_reschedule_offer', {
      p_token: appointmentToken,
      p_offer_id: offerId
    });
    if (error) throw error;
    await loadPersonalAppointment();
    toast('Tu cita fue cambiada al horario elegido.');
  } catch (error) {
    showError($('#appointment-error'), error.message);
    button.disabled = false;
  }
}
async function saveAppointmentReminderConsent(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { data, error } = await db.rpc('set_appointment_reminder_consent', {
      p_token: appointmentToken,
      p_email_enabled: $('#appointment-reminder-email').checked,
      p_push_enabled: $('#appointment-reminder-push').checked
    });
    if (error) throw error;
    if (!data) throw new Error('No se pudieron guardar las preferencias. Solo se permiten cambios en citas activas.');
    toast('Preferencias de recordatorios guardadas.');
  } catch (error) {
    showError($('#appointment-error'), error.message);
  } finally {
    button.disabled = false;
  }
}
async function submitAppointmentReview(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await db.rpc('submit_barber_review', {
      p_token: appointmentToken,
      p_rating: Number($('#appointment-review-rating').value),
      p_comment: $('#appointment-review-comment').value.trim()
    });
    if (error) throw error;
    await loadPersonalAppointment();
    if (barberSlug) await loadPublicReviews(barberSlug);
    toast('Gracias, tu reseña fue enviada.');
  } catch (error) {
    showError($('#appointment-error'), error.message);
    button.disabled = false;
  }
}
function appointmentServicesMarkup(services, total, amountCharged = null) {
  if (!Array.isArray(services) || !services.length) return '';
  const isFinal = amountCharged !== null && amountCharged !== undefined;
  const displayTotal = isFinal ? amountCharged : total;
  return `<section class="appointment-services"><strong>Servicios solicitados</strong>
    ${services.map((service) => `<div><span>${escapeHtml(service.name)}</span><strong>${formatCurrency(Number(service.price))}</strong></div>`).join('')}
    <div class="appointment-services-total"><span>${isFinal ? 'Total final' : 'Total estimado'}</span><strong>${formatCurrency(Number(displayTotal) || 0)}</strong></div>
  </section>`;
}
function transferVerificationLabel(status) {
  return ({
    pending: 'Transferencia pendiente de verificación',
    verified: 'Transferencia verificada',
    not_verified: 'Transferencia no verificada'
  })[status] || 'Transferencia pendiente de verificación';
}
function transferVerificationMessage(status) {
  return ({
    pending: 'El barbero revisará el pago y actualizará este enlace.',
    verified: 'El barbero confirmó que recibió tu pago.',
    not_verified: 'El barbero aún no pudo confirmar el pago. Revisa los datos de la transferencia y comunícate con la barbería si necesitas aclararlo.'
  })[status] || 'El barbero revisará el pago y actualizará este enlace.';
}
function decodeBase64Url(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
async function prepareNotificationSound() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Este navegador no permite audio personalizado.');
  if (!notificationSoundContext) notificationSoundContext = new AudioContextConstructor();
  await notificationSoundContext.resume();
  if (!notificationSoundBuffer) {
    const response = await fetch('./alerta-25.mp3');
    if (!response.ok) throw new Error(`No se pudo cargar el sonido (HTTP ${response.status}).`);
    notificationSoundBuffer = await notificationSoundContext.decodeAudioData(await response.arrayBuffer());
  }
}
async function prepareNewAppointmentSound() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Este navegador no permite audio personalizado.');
  if (!notificationSoundContext) notificationSoundContext = new AudioContextConstructor();
  await notificationSoundContext.resume();
  if (!newAppointmentSoundBuffer) {
    const response = await fetch('./alerta-21.mp3');
    if (!response.ok) throw new Error(`No se pudo cargar la alerta de solicitudes (HTTP ${response.status}).`);
    newAppointmentSoundBuffer = await notificationSoundContext.decodeAudioData(await response.arrayBuffer());
  }
}
async function setNotificationSoundEnabled(enabled) {
  const checkbox = $('#notification-sound-enabled');
  const status = $('#notification-sound-status');
  if (!enabled) {
    localStorage.removeItem(NOTIFICATION_SOUND_STORAGE_KEY);
    status.textContent = 'El sonido personalizado está desactivado.';
    return;
  }
  try {
    await prepareNotificationSound();
    localStorage.setItem(NOTIFICATION_SOUND_STORAGE_KEY, 'true');
    status.textContent = 'Sonido activado para notificaciones push recibidas mientras Barberlink esté abierta.';
  } catch (error) {
    checkbox.checked = false;
    localStorage.removeItem(NOTIFICATION_SOUND_STORAGE_KEY);
    status.textContent = `${error instanceof Error ? error.message : String(error)} Activa la opción de nuevo desde HTTPS o localhost.`;
  }
}
async function playNotificationSound() {
  if (localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY) !== 'true'
    || !notificationSoundContext
    || !notificationSoundBuffer) return;
  if (notificationSoundContext.state !== 'running') {
    await notificationSoundContext.resume();
  }
  const source = notificationSoundContext.createBufferSource();
  source.buffer = notificationSoundBuffer;
  source.connect(notificationSoundContext.destination);
  source.start();
}
async function setNewAppointmentSoundEnabled(enabled) {
  const checkbox = $('#new-appointment-sound-enabled');
  const status = $('#new-appointment-sound-status');
  if (!enabled) {
    localStorage.removeItem(NEW_APPOINTMENT_SOUND_STORAGE_KEY);
    status.textContent = 'La alerta de solicitudes nuevas está desactivada.';
    return;
  }
  try {
    await prepareNewAppointmentSound();
    localStorage.setItem(NEW_APPOINTMENT_SOUND_STORAGE_KEY, 'true');
    status.textContent = 'Alerta activada. Déjale abierto el panel para escuchar solicitudes nuevas.';
  } catch (error) {
    checkbox.checked = false;
    localStorage.removeItem(NEW_APPOINTMENT_SOUND_STORAGE_KEY);
    status.textContent = `${error instanceof Error ? error.message : String(error)} Activa la opción de nuevo desde HTTPS o localhost.`;
  }
}
function playNewAppointmentSound() {
  if (localStorage.getItem(NEW_APPOINTMENT_SOUND_STORAGE_KEY) !== 'true'
    || !notificationSoundContext
    || !newAppointmentSoundBuffer) return;
  const play = () => {
    const source = notificationSoundContext.createBufferSource();
    source.buffer = newAppointmentSoundBuffer;
    source.connect(notificationSoundContext.destination);
    source.start();
  };
  if (notificationSoundContext.state === 'running') play();
  else notificationSoundContext.resume().then(play).catch((error) => console.error('No se pudo reproducir la alerta de solicitud:', error));
}
async function prepareAppointmentPush() {
  try {
    if (!['https:', 'http:'].includes(window.location.protocol) || (window.location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(window.location.hostname))) {
      throw new Error('Las notificaciones requieren abrir la barbería desde HTTPS o desde localhost; no funcionan al abrir el archivo directamente.');
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('Este navegador no admite push. Recibirás los avisos por correo.');
    }
    if (!WEB_PUSH_PUBLIC_KEY || WEB_PUSH_PUBLIC_KEY.includes('PEGA_AQUI')) {
      throw new Error('Push aún no está configurado. Recibirás los avisos por correo.');
    }
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('No se autorizó el permiso push. Recibirás los avisos por correo.');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(WEB_PUSH_PUBLIC_KEY)
      });
    }
    return { subscription, message: '' };
  } catch (error) {
    return { subscription: null, message: describePushError(error) };
  }
}
function describePushError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/registration failed\s*-\s*push service error/i.test(message)) {
    return 'El servicio push del navegador no pudo registrar este dispositivo. Comprueba que WEB_PUSH_PUBLIC_KEY en app.js corresponda a VAPID_PUBLIC_KEY en los secretos de Supabase; si coinciden, vuelve a intentarlo más tarde o prueba otro navegador o red. Los avisos por correo siguen activos.';
  }
  return `${message} Los avisos por correo siguen activos.`;
}
async function registerAppointmentPush(token, subscription) {
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys?.auth) throw new Error('El navegador no entregó las claves necesarias para registrar las notificaciones.');
  const { error } = await db.rpc('register_appointment_push', {
    p_token: token,
    p_endpoint: subscription.endpoint,
    p_p256dh: keys.p256dh,
    p_auth_key: keys.auth
  });
  if (error) throw error;
}
async function retryAppointmentPush(event) {
  const button = event.currentTarget;
  const status = $('#booking-notification-message');
  if (!appointmentToken) {
    status.textContent = 'No se encontró el enlace de esta cita. Usa el enlace personal para consultar su estado.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Reintentando registro push…';
  status.textContent = 'Intentando registrar notificaciones push en este dispositivo…';
  try {
    const pushState = await prepareAppointmentPush();
    if (!pushState.subscription) {
      status.textContent = `Aceptaste recibir avisos por correo. ${pushState.message}`;
      return;
    }
    await registerAppointmentPush(appointmentToken, pushState.subscription);
    status.textContent = 'Aceptaste recibir avisos por correo. También recibirás avisos push en este dispositivo.';
    button.classList.add('hidden');
    toast('Notificaciones push activadas para esta cita.');
  } catch (error) {
    status.textContent = `Aceptaste recibir avisos por correo. ${describePushError(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Reintentar notificaciones push';
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
async function loadPersonalAppointment() {
  try {
    requireConnection();
    const { data, error } = await db.rpc('public_appointment_by_token', { token: appointmentToken });
    if (error) throw error;
    const appointment = Array.isArray(data) ? data[0] : data;
    if (!appointment) throw new Error('No encontramos una cita asociada a este enlace. Verifica que esté completo.');
    const activeElement = document.activeElement;
    if ($('#appointment-details').contains(activeElement)
      && activeElement.matches('input, textarea, select')) return;
    renderPersonalAppointment(appointment);
    if (appointment.status === 'accepted') {
      try {
        await loadPersonalRescheduleOffers();
      } catch (offersError) {
        showError($('#appointment-error'), offersError.message);
      }
    }
  } catch (error) {
    $('#appointment-details').innerHTML = '<div class="loading-state">No se pudo cargar la cita.</div>';
    showError($('#appointment-error'), error.message);
  }
}
async function cancelPersonalAppointment() {
  const button = $('#cancel-appointment');
  if (!window.confirm('¿Quieres cancelar esta cita? El horario quedará libre para otra persona.')) return;
  button.disabled = true;
  try {
    const { error } = await db.rpc('cancel_appointment', { token: appointmentToken });
    if (error) throw error;
    await loadPersonalAppointment();
    toast('Tu cita fue cancelada.');
  } catch (error) {
    showError($('#appointment-error'), error.message);
    button.disabled = false;
  }
}
async function checkSession() {
  const { data: { session } } = await db.auth.getSession();
  $('#logout-button').classList.toggle('hidden', !session);
  $('#login-panel').classList.toggle('hidden', !!session);
  $('#password-reset-panel').classList.add('hidden');
  $('#dashboard').classList.toggle('hidden', !session);
  if (session) await loadDashboard();
  else {
    $('#platform-admin-panel').classList.add('hidden');
    stopDashboardUpdates();
  }
}
function showPasswordReset(message = '') {
  showView('admin');
  $('#login-panel').classList.add('hidden');
  $('#dashboard').classList.add('hidden');
  $('#password-reset-panel').classList.remove('hidden');
  $('#password-reset-request-form').classList.add('hidden');
  $('#password-update-form').classList.remove('hidden');
  $('#password-reset-title').textContent = 'Crea una contraseña nueva';
  $('#password-reset-description').textContent = 'Elige una contraseña segura de al menos 8 caracteres.';
  $('#password-reset-error').classList.add('hidden');
  $('#password-reset-message').textContent = message;
  $('#password-reset-message').classList.toggle('hidden', !message);
}
async function requestPasswordReset(event) {
  event.preventDefault();
  const message = $('#password-reset-message');
  const errorMessage = $('#password-reset-error');
  message.classList.add('hidden');
  errorMessage.classList.add('hidden');
  if (!['http:', 'https:'].includes(window.location.protocol)) {
    showError(errorMessage, 'Abre la página con Live Server o desde su dirección HTTPS antes de solicitar el enlace.');
    return;
  }
  const button = $('#password-reset-request-form').querySelector('button');
  button.disabled = true;
  try {
    const redirectTo = new URL('./', window.location.href).href;
    const { error } = await db.auth.resetPasswordForEmail($('#recovery-email').value.trim(), { redirectTo });
    if (error) throw error;
    message.textContent = 'Si el correo está registrado, recibirás el enlace. Ábrelo en este mismo sitio para crear tu contraseña nueva.';
    message.classList.remove('hidden');
  } catch (error) {
    showError(errorMessage, error.message);
  } finally {
    button.disabled = false;
  }
}
async function updatePassword(event) {
  event.preventDefault();
  const password = $('#new-password').value;
  const confirmation = $('#confirm-password').value;
  if (password !== confirmation) {
    showError($('#password-reset-error'), 'Las contraseñas no coinciden.');
    return;
  }
  const button = $('#password-update-form').querySelector('button');
  button.disabled = true;
  $('#password-reset-error').classList.add('hidden');
  try {
    const { error } = await db.auth.updateUser({ password });
    if (error) throw error;
    $('#password-update-form').reset();
    await checkSession();
    toast('Contraseña actualizada.');
  } catch (error) {
    showError($('#password-reset-error'), error.message);
  } finally {
    button.disabled = false;
  }
}
async function signIn(event) {
  event.preventDefault();
  $('#login-error').classList.add('hidden');
  const submit = $('#login-form').querySelector('button');
  submit.disabled = true;
  try {
    requireConnection();
    const { error } = await db.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
    if (error) throw error;
    await checkSession();
  } catch (error) {
    showError($('#login-error'), error.message);
  } finally {
    submit.disabled = false;
  }
}
function createTwelveHourPicker(container) {
  const hour = document.createElement('select');
  hour.setAttribute('aria-label', 'Hora');
  hour.innerHTML = Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('');
  const minute = document.createElement('select');
  minute.setAttribute('aria-label', 'Minutos');
  minute.innerHTML = Array.from({ length: 60 }, (_, index) => {
    const value = String(index).padStart(2, '0');
    return `<option value="${value}">${value}</option>`;
  }).join('');
  const period = document.createElement('select');
  period.setAttribute('aria-label', 'a. m. o p. m.');
  period.innerHTML = '<option value="am">a. m.</option><option value="pm">p. m.</option>';
  container.replaceChildren(hour, minute, period);
}
function setTwelveHourPicker(container, value) {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  const hour12 = hours % 12 || 12;
  const minute = String(minutes).padStart(2, '0');
  const period = hours >= 12 ? 'pm' : 'am';
  const [hourSelect, minuteSelect, periodSelect] = container.querySelectorAll('select');
  hourSelect.value = String(hour12);
  minuteSelect.value = minute;
  periodSelect.value = period;
}
function getTwelveHourPickerValue(container) {
  const [hourSelect, minuteSelect, periodSelect] = container.querySelectorAll('select');
  let hour = Number(hourSelect.value) % 12;
  if (periodSelect.value === 'pm') hour += 12;
  return `${String(hour).padStart(2, '0')}:${minuteSelect.value}:00`;
}
function setScheduleControls(working, opensAt, closesAt) {
  $('#schedule-working').checked = working;
  setTwelveHourPicker($('#schedule-open-time'), opensAt);
  setTwelveHourPicker($('#schedule-close-time'), closesAt);
}
function selectedWeekdays() {
  return [...$('#schedule-weekdays').querySelectorAll('input:checked')].map((input) => Number(input.value));
}
async function loadScheduleEditor() {
  if (!adminBarberProfile) return;
  const requestId = ++scheduleLoadRequest;
  const mode = $('#schedule-mode').value;
  const date = $('#schedule-date').value;
  const weekdays = selectedWeekdays();
  const weekday = weekdays[0] ?? 1;
  $('#schedule-error').classList.add('hidden');
  $('#date-schedule-controls').classList.toggle('hidden', mode !== 'date');
  $('#weekly-schedule-controls').classList.toggle('hidden', mode !== 'weekly');
  $('#schedule-working-label').textContent = mode === 'weekly'
    ? 'Disponible en los días seleccionados'
    : 'Disponible en esta fecha';
  $('#clear-date-schedule').classList.add('hidden');
  try {
    if (mode === 'date') {
      if (!date) return;
      const { data: override, error } = await db.from('work_hour_overrides').select('is_working, opens_at, closes_at')
        .eq('barber_id', adminBarberProfile.id).eq('staff_id', adminStaffId).eq('work_date', date).maybeSingle();
      if (error) throw error;
      if (requestId !== scheduleLoadRequest) return;
      if (override) {
        setScheduleControls(override.is_working, override.opens_at, override.closes_at);
        $('#clear-date-schedule').classList.remove('hidden');
      } else {
        const { data: weekly, error: weeklyError } = await db.from('work_hours').select('is_working, opens_at, closes_at')
          .eq('barber_id', adminBarberProfile.id)
          .eq('staff_id', adminStaffId)
          .eq('weekday', new Date(`${date}T12:00:00Z`).getUTCDay()).maybeSingle();
        if (weeklyError) throw weeklyError;
        if (requestId !== scheduleLoadRequest) return;
        setScheduleControls(weekly?.is_working ?? false, weekly?.opens_at || '09:00:00', weekly?.closes_at || '18:00:00');
      }
    } else {
      const { data, error } = await db.from('work_hours').select('is_working, opens_at, closes_at')
        .eq('barber_id', adminBarberProfile.id).eq('staff_id', adminStaffId).eq('weekday', weekday).maybeSingle();
      if (error) throw error;
      if (requestId !== scheduleLoadRequest) return;
      setScheduleControls(data?.is_working ?? false, data?.opens_at || '09:00:00', data?.closes_at || '18:00:00');
    }
  } catch (error) {
    if (requestId !== scheduleLoadRequest) return;
    showError($('#schedule-error'), error.message);
  }
}
async function saveSchedule() {
  if (!adminBarberProfile) return;
  const mode = $('#schedule-mode').value;
  const date = $('#schedule-date').value;
  const working = $('#schedule-working').checked;
  const opensAt = getTwelveHourPickerValue($('#schedule-open-time'));
  const closesAt = getTwelveHourPickerValue($('#schedule-close-time'));
  const weekdays = selectedWeekdays();
  if (mode === 'weekly' && weekdays.length === 0) {
    showError($('#schedule-error'), 'Selecciona al menos un día para aplicar este horario.');
    return;
  }
  if (opensAt >= closesAt) {
    showError($('#schedule-error'), 'La hora de cierre debe ser posterior a la hora de apertura.');
    return;
  }
  if (mode === 'date' && !date) {
    showError($('#schedule-error'), 'Selecciona la fecha que quieres ajustar.');
    return;
  }
  const button = $('#save-schedule');
  const originalButtonText = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Guardando horario…';
  $('#schedule-error').classList.add('hidden');
  try {
    const row = mode === 'weekly'
      ? weekdays.map((weekday) => ({ barber_id: adminBarberProfile.id, staff_id: adminStaffId, weekday, is_working: working, opens_at: opensAt, closes_at: closesAt }))
      : { barber_id: adminBarberProfile.id, staff_id: adminStaffId, work_date: date, is_working: working, opens_at: opensAt, closes_at: closesAt };
    const table = mode === 'weekly' ? 'work_hours' : 'work_hour_overrides';
    const conflict = mode === 'weekly' ? 'barber_id,staff_id,weekday' : 'barber_id,staff_id,work_date';
    const { data, error } = await db.from(table).upsert(row, { onConflict: conflict }).select();
    if (error) throw error;
    const expectedRows = mode === 'weekly' ? weekdays.length : 1;
    if (data?.length !== expectedRows) {
      throw new Error('Supabase no confirmó todos los días seleccionados. Revisa los permisos del barbero y vuelve a intentar.');
    }
    await loadScheduleEditor();
    await loadAdminAppointments();
    toast(mode === 'weekly' ? 'Horario habitual guardado.' : 'Horario para la fecha guardado.');
  } catch (error) {
    showError($('#schedule-error'), error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = originalButtonText;
  }
}
async function clearDateSchedule() {
  if (!adminBarberProfile || !$('#schedule-date').value) return;
  const { error } = await db.from('work_hour_overrides').delete()
    .eq('barber_id', adminBarberProfile.id).eq('staff_id', adminStaffId).eq('work_date', $('#schedule-date').value);
  if (error) {
    showError($('#schedule-error'), error.message);
    return;
  }
  await loadScheduleEditor();
  await loadAdminAppointments();
  toast('Se restauró el horario habitual para esa fecha.');
}
async function saveSlotDuration() {
  const duration = Number($('#slot-duration').value);
  const button = $('#save-slot-duration');
  button.disabled = true;
  $('#duration-error').classList.add('hidden');
  try {
    const { data, error } = await db.from('barber_team_members')
      .update({ slot_minutes: duration })
      .eq('id', adminStaffId)
      .eq('barber_id', adminBarberProfile.id)
      .select('id, slot_minutes')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No se pudo guardar el intervalo del barbero. Verifica los permisos de su cuenta.');
    adminStaffConfig.slot_minutes = data.slot_minutes;
    const member = teamMembers.find((item) => item.id === adminStaffId);
    if (member) member.slot_minutes = data.slot_minutes;
    await loadAdminAppointments();
    toast(`Intervalo entre horarios guardado: ${data.slot_minutes === 60 ? '1 hora' : `${data.slot_minutes} minutos`}.`);
  } catch (error) {
    showError($('#duration-error'), error.message);
  } finally {
    button.disabled = false;
  }
}
async function saveTransferDetails() {
  const button = $('#save-transfer-details');
  const errorElement = $('#transfer-settings-error');
  errorElement.classList.add('hidden');
  const methods = transferMethodState.map((method) => ({
    type: method.type,
    label: method.label.trim(),
    account_type: method.type === 'bank' ? method.account_type : '',
    account_number: method.account_number.trim(),
    holder: method.holder.trim(),
    document: method.document.trim()
  })).filter((method) => method.label || method.account_type || method.account_number || method.holder || method.document);
  for (const [index, method] of methods.entries()) {
    if (!method.label || !method.account_number || !method.holder) {
      showError(errorElement, `Completa el nombre del medio, el número y el titular en el medio ${index + 1}, o quítalo antes de guardar.`);
      return;
    }
    if (method.type === 'bank' && !method.account_type) {
      showError(errorElement, `Selecciona el tipo de cuenta bancaria en el medio ${index + 1}.`);
      return;
    }
  }
  const services = [];
  if (serviceCatalogState.length > 20) {
    showError(errorElement, 'Puedes guardar hasta 20 servicios.');
    return;
  }
  for (const [index, service] of serviceCatalogState.entries()) {
    const name = service.name.trim();
    const price = Number(service.price);
    if (!name || name.length > 60 || !Number.isSafeInteger(price) || price <= 0 || price > 1000000000) {
      showError(errorElement, `Completa un nombre de hasta 60 caracteres y un precio válido en el servicio ${index + 1}, o quítalo antes de guardar.`);
      return;
    }
    services.push({ id: service.id, name, price });
  }
  const values = { transfer_methods: methods, service_catalog: services };
  button.disabled = true;
  try {
    const { data, error } = await db.from('barber_team_members')
      .update(values)
      .eq('id', adminStaffId)
      .eq('barber_id', adminBarberProfile.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No se guardaron los datos del barbero seleccionado. Verifica los permisos de su cuenta.');
    Object.assign(adminStaffConfig, values);
    const member = teamMembers.find((item) => item.id === adminStaffId);
    if (member) Object.assign(member, values);
    renderServiceCatalogEditors();
    toast('Servicios, precios y medios de pago guardados para este barbero.');
  } catch (error) {
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
  }
}
function loadServiceCatalogSettings(profile) {
  const services = Array.isArray(profile.service_catalog) ? profile.service_catalog : [];
  serviceCatalogState = services.map((service) => ({
    id: service.id || crypto.randomUUID(),
    name: service.name || '',
    price: String(service.price ?? '')
  }));
  renderServiceCatalogEditors();
}
function renderServiceCatalogEditors() {
  const container = $('#service-catalog-list');
  container.replaceChildren();
  if (!serviceCatalogState.length) {
    container.innerHTML = '<p class="form-note">Aún no agregas servicios. Los clientes no podrán solicitar una cita hasta que publiques al menos uno.</p>';
  }
  serviceCatalogState.forEach((service, index) => {
    const editor = document.createElement('article');
    editor.className = 'service-catalog-item';
    editor.innerHTML = `
      <div class="transfer-method-heading"><strong>Servicio ${index + 1}</strong><button class="break-remove" type="button" data-remove-service="${index}">Quitar</button></div>
      <label class="field-label">Nombre del servicio</label>
      <input type="text" maxlength="60" data-service-field="name" data-index="${index}" value="${escapeHtml(service.name)}" placeholder="Ej. Corte normal">
      <label class="field-label">Precio (COP)</label>
      <input type="number" inputmode="numeric" min="1" max="1000000000" step="1" data-service-field="price" data-index="${index}" value="${escapeHtml(service.price)}" placeholder="Ej. 20000">`;
    container.append(editor);
  });
  container.querySelectorAll('[data-service-field]').forEach((input) => {
    input.addEventListener('input', updateServiceCatalogField);
  });
  container.querySelectorAll('[data-remove-service]').forEach((button) => {
    button.addEventListener('click', () => {
      serviceCatalogState.splice(Number(button.dataset.removeService), 1);
      renderServiceCatalogEditors();
    });
  });
}
function updateServiceCatalogField(event) {
  const input = event.currentTarget;
  const service = serviceCatalogState[Number(input.dataset.index)];
  if (service) service[input.dataset.serviceField] = input.value;
}
function addService() {
  if (serviceCatalogState.length >= 20) {
    toast('Puedes configurar hasta 20 servicios.');
    return;
  }
  serviceCatalogState.push({ id: crypto.randomUUID(), name: '', price: '' });
  renderServiceCatalogEditors();
}
function renderTransferMethodEditors() {
  const container = $('#transfer-method-list');
  container.replaceChildren();
  transferMethodState.forEach((method, index) => {
    const card = document.createElement('article');
    card.className = 'transfer-method-editor';
    card.innerHTML = `
      <div class="transfer-method-heading">
        <strong>Medio ${index + 1}</strong>
        <button class="break-remove" type="button" data-remove-transfer="${index}">Quitar</button>
      </div>
      <label class="field-label">Tipo de medio</label>
      <select data-transfer-field="type" data-index="${index}">
        <option value="bank" ${method.type === 'bank' ? 'selected' : ''}>Cuenta bancaria</option>
        <option value="nequi" ${method.type === 'nequi' ? 'selected' : ''}>Nequi</option>
        <option value="daviplata" ${method.type === 'daviplata' ? 'selected' : ''}>Daviplata</option>
        <option value="other" ${method.type === 'other' ? 'selected' : ''}>Otro medio</option>
      </select>
      <label class="field-label">${method.type === 'bank' ? 'Banco' : 'Nombre del medio'}</label>
      <input type="text" maxlength="80" data-transfer-field="label" data-index="${index}" value="${escapeHtml(method.label)}" placeholder="${method.type === 'bank' ? 'Ej. Bancolombia' : method.type === 'other' ? 'Ej. Transfiya' : method.type === 'nequi' ? 'Nequi' : 'Daviplata'}">
      ${method.type === 'bank' ? `<label class="field-label">Tipo de cuenta</label><select data-transfer-field="account_type" data-index="${index}"><option value="">Selecciona</option><option value="Ahorros" ${method.account_type === 'Ahorros' ? 'selected' : ''}>Ahorros</option><option value="Corriente" ${method.account_type === 'Corriente' ? 'selected' : ''}>Corriente</option></select>` : ''}
      <label class="field-label">Número de cuenta o celular</label>
      <input type="text" inputmode="text" maxlength="40" data-transfer-field="account_number" data-index="${index}" value="${escapeHtml(method.account_number)}">
      <label class="field-label">Titular</label>
      <input type="text" maxlength="100" data-transfer-field="holder" data-index="${index}" value="${escapeHtml(method.holder)}">
      <label class="field-label">Documento del titular (opcional)</label>
      <input type="text" maxlength="30" data-transfer-field="document" data-index="${index}" value="${escapeHtml(method.document)}">`;
    container.append(card);
  });
  container.querySelectorAll('[data-transfer-field]').forEach((input) => {
    input.addEventListener('change', updateTransferMethodField);
    if (input.tagName === 'INPUT') input.addEventListener('input', updateTransferMethodField);
  });
  container.querySelectorAll('[data-remove-transfer]').forEach((button) => {
    button.addEventListener('click', () => {
      transferMethodState.splice(Number(button.dataset.removeTransfer), 1);
      renderTransferMethodEditors();
    });
  });
}
function updateTransferMethodField(event) {
  const input = event.currentTarget;
  const method = transferMethodState[Number(input.dataset.index)];
  if (!method) return;
  const previousType = method.type;
  method[input.dataset.transferField] = input.value;
  if (input.dataset.transferField === 'type') {
    const defaultLabels = { nequi: 'Nequi', daviplata: 'Daviplata' };
    if (method.label === defaultLabels[previousType]) method.label = '';
    if (defaultLabels[method.type] && !method.label) method.label = defaultLabels[method.type];
    if (method.type !== 'bank') method.account_type = '';
    renderTransferMethodEditors();
  }
}
function addTransferMethod(type = 'bank') {
  transferMethodState.push({ type, label: type === 'nequi' ? 'Nequi' : type === 'daviplata' ? 'Daviplata' : '', account_type: '', account_number: '', holder: '', document: '' });
  renderTransferMethodEditors();
}
function loadTransferMethodSettings(profile) {
  const methods = Array.isArray(profile.transfer_methods) ? profile.transfer_methods.filter(Boolean) : [];
  transferMethodState = methods.map((method) => ({
    type: ['bank', 'nequi', 'daviplata', 'other'].includes(method.type) ? method.type : 'other',
    label: method.label || '',
    account_type: method.account_type || '',
    account_number: method.account_number || '',
    holder: method.holder || '',
    document: method.document || ''
  }));
  renderTransferMethodEditors();
}
async function loadBreaks(date) {
  const container = $('#break-list');
  if (!container || !adminBarberProfile || !date) return;
  const start = `${date}T00:00:00-05:00`;
  const end = `${shiftDate(date, 1)}T00:00:00-05:00`;
  const { data, error } = await db.from('blocked_slots')
    .select('id, starts_at, ends_at, reason')
    .eq('barber_id', adminBarberProfile.id)
    .eq('staff_id', adminStaffId)
    .gte('starts_at', start)
    .lt('starts_at', end)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  if (!data?.length) {
    container.innerHTML = '<p class="form-note">No hay descansos configurados para este día.</p>';
    return;
  }
  container.replaceChildren();
  data.forEach((breakSlot) => {
    const startTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(breakSlot.starts_at));
    const endTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(breakSlot.ends_at));
    const item = document.createElement('div');
    item.className = 'break-item';
    item.innerHTML = `<span>${formatTime(startTime)} – ${formatTime(endTime)}${breakSlot.reason ? ` · ${escapeHtml(breakSlot.reason)}` : ''}</span><button class="break-remove" type="button" aria-label="Eliminar descanso">Quitar</button>`;
    item.querySelector('button').addEventListener('click', () => removeBreak(breakSlot.id, date));
    container.append(item);
  });
}
async function addBreak() {
  const date = $('#break-date').value;
  const startTime = $('#break-start').value;
  const endTime = $('#break-end').value;
  const reason = $('#break-reason').value.trim();
  const button = $('#add-break');
  $('#break-error').classList.add('hidden');
  if (!date || !startTime || !endTime || startTime >= endTime) {
    showError($('#break-error'), 'Elige una fecha y un intervalo válido. La hora final debe ser posterior a la inicial.');
    return;
  }
  if (date < dateInBogota()) {
    showError($('#break-error'), 'No puedes agregar un descanso a una fecha pasada.');
    return;
  }
  button.disabled = true;
  try {
    const { data: appointments, error: appointmentsError } = await db.from('appointments')
      .select('appointment_time, status')
      .eq('barber_id', adminBarberProfile.id)
      .eq('staff_id', adminStaffId)
      .eq('appointment_date', date)
      .in('status', ['pending', 'accepted']);
    if (appointmentsError) throw appointmentsError;
    const duration = Number(adminStaffConfig?.slot_minutes);
    const overlap = (appointments || []).some((appointment) => {
      const [hour, minute] = appointment.appointment_time.slice(0, 5).split(':').map(Number);
      const appointmentStart = hour * 60 + minute;
      const requestedStart = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
      const requestedEnd = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
      return appointmentStart < requestedEnd && appointmentStart + duration > requestedStart;
    });
    if (overlap) throw new Error('Ese descanso se cruza con una cita pendiente o aceptada. Cambia el intervalo o reprograma la cita primero.');
    const row = {
      barber_id: adminBarberProfile.id,
      staff_id: adminStaffId,
      starts_at: `${date}T${startTime}:00-05:00`,
      ends_at: `${date}T${endTime}:00-05:00`,
      reason: reason || null
    };
    const { error } = await db.from('blocked_slots').insert(row);
    if (error) throw error;
    $('#break-reason').value = '';
    await loadBreaks(date);
    await loadAdminAppointments();
    toast('Descanso agregado; esas horas ya no estarán disponibles.');
  } catch (error) {
    showError($('#break-error'), error.message);
  } finally {
    button.disabled = false;
  }
}
async function removeBreak(id, date) {
  if (!window.confirm('¿Quitar este descanso y volver a ofrecer esas horas?')) return;
  try {
    const { error } = await db.from('blocked_slots').delete()
      .eq('id', id).eq('barber_id', adminBarberProfile.id).eq('staff_id', adminStaffId);
    if (error) throw error;
    await loadBreaks(date);
    await loadAdminAppointments();
    toast('Descanso eliminado.');
  } catch (error) {
    showError($('#break-error'), error.message);
  }
}
async function loadTeamMembers() {
  const { data, error } = await db.from('barber_team_members')
    .select('id, display_name, email, auth_user_id, is_active, is_primary, service_catalog, transfer_methods, slot_minutes')
    .eq('barber_id', adminBarberProfile.id)
    .order('is_primary', { ascending: false })
    .order('display_name', { ascending: true });
  if (error) throw error;
  teamMembers = data || [];
  const selectableMembers = teamMembers.filter((member) => member.is_active);
  const adminMembers = isShopOwner ? teamMembers : selectableMembers;
  const selector = $('#admin-staff');
  selector.replaceChildren();
  adminMembers.forEach((member) => {
    const option = document.createElement('option');
    option.value = member.id;
    option.textContent = `${member.display_name}${member.is_active ? '' : ' (desactivado)'}`;
    selector.append(option);
  });
  $('#team-dashboard-selector').classList.toggle('hidden', !isShopOwner || adminMembers.length < 2);
  const selectedMemberExists = adminMembers.some((member) => member.id === adminStaffId);
  selector.value = selectedMemberExists ? adminStaffId : (signedInStaffId || selectableMembers[0]?.id || '');
  if (!signedInStaffId) adminStaffId = selector.value;
  selector.disabled = !isShopOwner;
  $('#staff-agenda-note').textContent = `Estás gestionando la agenda de ${adminMembers.find((member) => member.id === adminStaffId)?.display_name || 'este barbero'}.`;
  $('#staff-agenda-note').classList.remove('hidden');
}
async function refreshSelectedStaff() {
  if (!adminBarberProfile || !adminStaffId) return;
  $('#schedule-date').value = $('#admin-date').value;
  await loadScheduleEditor();
  await loadBreaks($('#break-date').value);
  await loadAdminAppointments();
}
function loadSelectedStaffSettings() {
  adminStaffConfig = teamMembers.find((member) => member.id === adminStaffId) || null;
  if (!adminStaffConfig) return;
  $('#slot-duration').value = String(adminStaffConfig.slot_minutes);
  loadTransferMethodSettings(adminStaffConfig);
  loadServiceCatalogSettings(adminStaffConfig);
}
async function loadPlatformAdminBarbers(preferredBarberId = '') {
  const selector = $('#platform-admin-barber');
  const { data, error } = await db.rpc('platform_admin_list_barbers');
  if (error) throw error;
  const previousBarberId = preferredBarberId || selector.value;
  selector.replaceChildren();
  if (!Array.isArray(data) || data.some((barber) => !barber || !isUuid(barber.id))) {
    throw new Error('Supabase devolvió una barbería sin un ID UUID válido. Revisa platform_admin_list_barbers en supabase-platform-admin-migration.sql.');
  }
  platformBarbers = data;
  platformBarbers.forEach((barber) => {
    const option = document.createElement('option');
    option.value = barber.id;
    option.textContent = `${barber.display_name} · ?barber=${barber.slug}`;
    selector.append(option);
  });
  if (!platformBarbers.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No hay barberías registradas';
    selector.append(option);
  }
  selector.disabled = !platformBarbers.length;
  $('#platform-admin-add-member').disabled = !platformBarbers.length;
  $('#platform-admin-delete-shop').disabled = !platformBarbers.length;
  selector.value = platformBarbers.some((barber) => barber.id === previousBarberId)
    ? previousBarberId
    : platformBarbers[0]?.id || '';
  await loadPlatformAdminTeam();
}
async function loadPlatformAdminTeam() {
  const container = $('#platform-admin-team-list');
  const barberId = selectedPlatformBarberId();
  container.replaceChildren();
  if (!barberId) {
    container.innerHTML = '<p class="form-note">Selecciona una barbería para ver su equipo.</p>';
    return;
  }
  const { data, error } = await db.rpc('platform_admin_list_team_members', { p_barber_id: barberId });
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error('Supabase devolvió una respuesta inválida al cargar el equipo de la barbería.');
  }
  if (data.some((member) => !member || !isUuid(member.id))) {
    throw new Error('Supabase devolvió un profesional sin un ID UUID válido. Revisa platform_admin_list_team_members en supabase-platform-admin-migration.sql.');
  }
  if (!data.length) {
    container.innerHTML = '<p class="form-note">Esta barbería todavía no tiene profesionales agregados.</p>';
    return;
  }
  data.forEach((member) => {
    const item = document.createElement('article');
    item.className = 'team-member-card';
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = member.display_name;
    const status = document.createElement('p');
    status.className = 'form-note';
    status.textContent = `${member.email || 'Sin correo'} · ${member.has_account ? 'Cuenta vinculada' : 'Pendiente de vincular'} · ${member.is_active ? 'Activo' : 'Inactivo'}`;
    details.append(name, status);
    const actions = document.createElement('div');
    actions.className = 'team-member-actions';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'reject-button';
    deleteButton.dataset.staffId = member.id;
    deleteButton.textContent = 'Eliminar permanentemente';
    deleteButton.addEventListener('click', () => deletePlatformAdminMember(member));
    actions.append(deleteButton);
    item.append(details, actions);
    container.append(item);
  });
}
async function loadPlatformAdminReviews() {
  const container = $('#platform-admin-review-list');
  const { data, error } = await db.rpc('platform_admin_list_reviews');
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error('Supabase devolvió una respuesta inválida al cargar los comentarios de las barberías.');
  }
  container.replaceChildren();
  if (!data.length) {
    container.innerHTML = '<p class="form-note">Todavía no hay comentarios publicados.</p>';
    return;
  }
  data.forEach((review) => {
    if (!review || !isUuid(review.review_id)) {
      throw new Error('Supabase devolvió un comentario sin un ID válido.');
    }
    const item = document.createElement('article');
    item.className = 'team-member-card';
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = `${review.barber_name} · ${review.first_name} · ${'★'.repeat(Number(review.rating) || 0)}`;
    const comment = document.createElement('p');
    comment.className = 'form-note';
    comment.textContent = review.comment || 'Sin comentario escrito.';
    const date = document.createElement('p');
    date.className = 'form-note';
    date.textContent = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Bogota'
    }).format(new Date(review.created_at));
    details.append(heading, comment, date);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'reject-button';
    remove.textContent = 'Eliminar comentario';
    remove.addEventListener('click', () => deletePlatformAdminReview(review, remove));
    item.append(details, remove);
    container.append(item);
  });
}
async function deletePlatformAdminReview(review, button) {
  if (!window.confirm(`¿Eliminar permanentemente este comentario de ${review.barber_name}? Esta acción no se puede deshacer.`)) return;
  button.disabled = true;
  const errorElement = $('#platform-admin-error');
  errorElement.classList.add('hidden');
  try {
    const { data, error } = await db.rpc('platform_admin_delete_review', {
      p_review_id: review.review_id
    });
    if (error) throw error;
    if (!data) throw new Error('La reseña ya no existe o no se pudo eliminar.');
    await loadPlatformAdminReviews();
    toast('Reseña eliminada; su calificación ya no cuenta en el promedio.');
  } catch (error) {
    showError(errorElement, error.message);
    button.disabled = false;
  }
}
function confirmPermanentDeletion(name, description) {
  const confirmation = window.prompt(`${description}\n\nPara confirmar, escribe exactamente: ${name}`);
  return confirmation !== null && confirmation.trim() === name.trim();
}
async function deletePlatformAdminMember(member) {
  const barberId = selectedPlatformBarberId();
  if (!member || !isUuid(member.id) || !barberId) {
    showError($('#platform-admin-error'), 'No se pudo identificar la barbería o el profesional. Vuelve a seleccionar la barbería y recarga el panel.');
    return;
  }
  if (!confirmPermanentDeletion(
    member.display_name,
    `Se eliminarán permanentemente las citas, el historial de pagos, los horarios y los datos de ${member.display_name}. Su cuenta de Supabase Auth no se eliminará, pero perderá acceso a esta barbería.`
  )) return;
  const button = [...$('#platform-admin-team-list').querySelectorAll('button')]
    .find((item) => item.dataset.staffId === member.id);
  if (button) button.disabled = true;
  const errorElement = $('#platform-admin-error');
  errorElement.classList.add('hidden');
  try {
    const { error } = await db.rpc('platform_admin_delete_team_member', {
      p_barber_id: barberId,
      p_staff_id: member.id
    });
    if (error) throw error;
    await loadPlatformAdminBarbers(barberId);
    toast(`${member.display_name} y sus datos asociados fueron eliminados.`);
  } catch (error) {
    showError(errorElement, error.message);
  } finally {
    if (button) button.disabled = false;
  }
}
async function deletePlatformAdminBarbershop() {
  const barberId = selectedPlatformBarberId();
  const barber = platformBarbers.find((item) => item.id === barberId);
  if (!barberId || !barber) {
    showError($('#platform-admin-error'), 'No se pudo identificar la barbería seleccionada. Vuelve a seleccionarla y recarga el panel.');
    return;
  }
  if (!confirmPermanentDeletion(
    barber.display_name,
    `Se eliminarán permanentemente ${barber.display_name}, todos sus profesionales, horarios, citas e historial de pagos. Las cuentas de Supabase Auth no se eliminarán.`
  )) return;
  const button = $('#platform-admin-delete-shop');
  const errorElement = $('#platform-admin-error');
  errorElement.classList.add('hidden');
  button.disabled = true;
  try {
    const { error } = await db.rpc('platform_admin_delete_barbershop', {
      p_barber_id: barberId
    });
    if (error) throw error;
    await loadPlatformAdminBarbers();
    toast(`${barber.display_name} y todos sus datos asociados fueron eliminados.`);
  } catch (error) {
    showError(errorElement, error.message);
  } finally {
    button.disabled = !platformBarbers.length;
  }
}
async function addPlatformAdminMember() {
  const barberId = selectedPlatformBarberId();
  const nameInput = $('#platform-admin-name');
  const emailInput = $('#platform-admin-email');
  const name = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  const errorElement = $('#platform-admin-error');
  errorElement.classList.add('hidden');
  if (!barberId || !name || name.length > 100) {
    showError(errorElement, 'Selecciona una barbería y escribe el nombre del profesional.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError(errorElement, 'Escribe el correo de una cuenta existente de Supabase Auth.');
    return;
  }
  const button = $('#platform-admin-add-member');
  button.disabled = true;
  try {
    const { error } = await db.rpc('platform_admin_add_team_member', {
      p_barber_id: barberId,
      p_display_name: name,
      p_email: email
    });
    if (error) throw error;
    nameInput.value = '';
    emailInput.value = '';
    await loadPlatformAdminBarbers(barberId);
    toast(`${name} ya aparece en el equipo de la barbería seleccionada.`);
  } catch (error) {
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
  }
}
function slugifyBarbershopName(value) {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
}
async function createPlatformBarbershop() {
  const nameInput = $('#platform-admin-shop-name');
  const slugInput = $('#platform-admin-shop-slug');
  const name = nameInput.value.trim();
  const slug = slugInput.value.trim().toLowerCase();
  const errorElement = $('#platform-admin-error');
  errorElement.classList.add('hidden');
  if (!name || name.length > 100) {
    showError(errorElement, 'Escribe el nombre público de la barbería.');
    return;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    showError(errorElement, 'El enlace corto solo puede usar minúsculas, números y guiones.');
    return;
  }
  const button = $('#platform-admin-create-shop');
  button.disabled = true;
  try {
    const { data: barberId, error } = await db.rpc('platform_admin_create_barbershop', {
      p_slug: slug,
      p_display_name: name
    });
    if (error) throw error;
    if (!isUuid(barberId)) {
      throw new Error('Supabase creó la barbería, pero no devolvió un ID UUID válido. Recarga la lista antes de continuar.');
    }
    nameInput.value = '';
    slugInput.value = '';
    await loadPlatformAdminBarbers(barberId);
    toast(`${name} ya está creada. Ahora agrega sus trabajadores. Enlace: ?barber=${slug}`);
  } catch (error) {
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
  }
}
async function loadDashboard() {
  try {
    $('#admin-error').classList.add('hidden');
    $('#platform-admin-error').classList.add('hidden');
    const { data: platformAdmin, error: platformAdminError } = await db.rpc('is_platform_admin');
    if (platformAdminError) throw platformAdminError;
    isPlatformAdmin = Boolean(platformAdmin);
    if (platformAdminRequested) {
      stopDashboardUpdates();
      $('#dashboard').classList.add('hidden');
      $('#platform-admin-panel').classList.remove('hidden');
      $('#login-panel').classList.add('hidden');
      $('#platform-admin-tools').classList.toggle('hidden', !isPlatformAdmin);
      if (!isPlatformAdmin) {
        showError($('#platform-admin-error'), 'Esta cuenta no tiene acceso al panel de administración de barberías.');
        return;
      }
      await loadPlatformAdminBarbers();
      await loadPlatformAdminReviews();
      return;
    }
    $('#platform-admin-panel').classList.add('hidden');
    const { data: barberId, error: barberIdError } = await db.rpc('current_barber_id');
    if (barberIdError) throw barberIdError;
    const [{ data: staffId, error: staffIdError }, { data: owner, error: ownerError }] = await Promise.all([
      db.rpc('current_staff_id'),
      db.rpc('is_barber_owner')
    ]);
    if (staffIdError) throw staffIdError;
    if (ownerError) throw ownerError;
    signedInStaffId = staffId || null;
    isShopOwner = Boolean(owner);
    const { data: config, error: configError } = await db.from('barber_profiles')
    .select('id, slug, display_name, is_open, public_description, public_address, public_phone, public_maps_url')
      .eq('id', barberId)
      .single();
    if (configError) throw configError;
    adminBarberProfile = config;
    $('#public-description').value = config.public_description || '';
    $('#public-address').value = config.public_address || '';
    $('#public-phone').value = config.public_phone || '';
    $('#public-maps-url').value = config.public_maps_url || '';
    $('#admin-profile-link').href = publicBarberUrl();
    $('#admin-profile-link').textContent = publicBarberUrl();
    renderQrCode($('#admin-profile-qr'), publicBarberUrl());
    adminStaffId = signedInStaffId;
    await loadTeamMembers();
    const { data: { session }, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    const signedInMember = teamMembers.find((member) => member.id === signedInStaffId)
      || (isShopOwner ? teamMembers.find((member) => member.is_primary) : null);
    const accountType = isShopOwner ? 'Cuenta de dueño' : 'Cuenta de barbero';
    const accountName = signedInMember?.display_name || (isShopOwner ? 'Dueño' : 'Barbero');
    const accountEmail = session?.user?.email ? ` · ${session.user.email}` : '';
    $('#dashboard-account-label').textContent = `${accountType}: ${accountName}${accountEmail} · Barbería: ${config.display_name}`;
    $('#open-toggle').disabled = false;
    loadSelectedStaffSettings();
    updateBookingEntry();
    $('#open-toggle').checked = config.is_open;
    $('#open-label').textContent = config.is_open ? 'Abierta' : 'Cerrada';
    $('#brand-name').textContent = config.display_name.toLocaleUpperCase('es-CO');
    await refreshSelectedStaff();
    subscribeDashboard();
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      loadAdminAppointments();
      if (activeDashboardSection === 'calendar') loadCalendarWeek();
    }, 5000);
  } catch (error) {
    showError(platformAdminRequested ? $('#platform-admin-error') : $('#admin-error'), error.message);
  }
}
async function loadAdminAppointments() {
  const date = $('#admin-date').value;
  if (!date || !db || !adminBarberProfile) return;
  try {
    const { error: expiryError } = await db.rpc('expire_barber_pending_appointments');
    if (expiryError) throw expiryError;
    const [pendingResult, appointmentsResult, debtsResult] = await Promise.all([
      db.from('appointments')
        .select('id, staff_id, customer_name, customer_phone, customer_email, appointment_date, appointment_time, payment_method, transfer_now, status, expires_at, created_at, requested_services, quoted_amount')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .eq('status', 'pending')
        .gte('appointment_date', dateInBogota())
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true }),
      db.from('appointments')
        .select('id, staff_id, customer_name, customer_phone, customer_email, appointment_date, appointment_time, payment_method, transfer_verification_status, status, expires_at, delay_minutes, payment_status, debt_amount, created_at, requested_services, quoted_amount')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .eq('status', 'accepted')
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true }),
      db.from('appointments')
        .select('id, staff_id, customer_name, customer_phone, appointment_date, appointment_time, payment_method, payment_status, debt_amount, completed_at')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .eq('status', 'attended')
        .eq('payment_status', 'debt')
        .order('appointment_date', { ascending: false })
        .order('appointment_time', { ascending: false })
    ]);
    if (pendingResult.error) throw pendingResult.error;
    if (appointmentsResult.error) throw appointmentsResult.error;
    if (debtsResult.error) throw debtsResult.error;
    const pendingAppointments = pendingResult.data || [];
    const acceptedAppointments = appointmentsResult.data || [];
    const currentPendingIds = new Set(pendingAppointments.map((appointment) => appointment.id));
    const scope = `${adminBarberProfile.id}:${adminStaffId || 'owner'}`;
    if (pendingAppointmentSnapshotScope !== scope || knownPendingAppointmentIds === null) {
      pendingAppointmentSnapshotScope = scope;
      knownPendingAppointmentIds = currentPendingIds;
    } else {
      const newRequests = [...currentPendingIds].filter((id) => !knownPendingAppointmentIds.has(id));
      knownPendingAppointmentIds = currentPendingIds;
      if (newRequests.length && localStorage.getItem(NEW_APPOINTMENT_SOUND_STORAGE_KEY) === 'true') {
        newRequests.forEach(() => playNewAppointmentSound());
      }
    }
    renderAdminAppointments(pendingAppointments, acceptedAppointments, debtsResult.data || []);
    $('#admin-error').classList.add('hidden');
  } catch (error) {
    showError($('#admin-error'), error.message);
  }
}
function getWeekStart(date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}
async function loadCalendarWeek() {
  const container = $('#calendar-week-list');
  const errorElement = $('#calendar-error');
  if (!container || !adminBarberProfile || !adminStaffId) return;
  const requestId = ++calendarLoadRequest;
  if (!calendarWeekStart) calendarWeekStart = getWeekStart(dateInBogota());
  const weekStart = calendarWeekStart;
  const weekEnd = shiftDate(weekStart, 7);
  errorElement.classList.add('hidden');
  container.replaceChildren();
  $('#calendar-week-label').textContent = `${formatBookingDate(weekStart)} al ${formatBookingDate(shiftDate(weekEnd, -1))}`;
  try {
    const { data, error } = await db.from('appointments')
      .select('id, customer_name, customer_phone, appointment_date, appointment_time, status, payment_method, requested_services, quoted_amount')
      .eq('barber_id', adminBarberProfile.id)
      .eq('staff_id', adminStaffId)
      .in('status', ['pending', 'accepted'])
      .gte('appointment_date', weekStart)
      .lt('appointment_date', weekEnd)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });
    if (error) throw error;
    if (requestId !== calendarLoadRequest) return;
    const appointmentsByDate = new Map();
    for (const appointment of data || []) {
      if (!appointmentsByDate.has(appointment.appointment_date)) appointmentsByDate.set(appointment.appointment_date, []);
      appointmentsByDate.get(appointment.appointment_date).push(appointment);
    }
    for (let offset = 0; offset < 7; offset += 1) {
      const date = shiftDate(weekStart, offset);
      const day = document.createElement('section');
      day.className = 'calendar-day';
      const heading = document.createElement('h3');
      heading.textContent = formatBookingDate(date);
      day.append(heading);
      const appointments = appointmentsByDate.get(date) || [];
      if (!appointments.length) {
        const empty = document.createElement('p');
        empty.className = 'form-note';
        empty.textContent = 'Sin citas pendientes ni aceptadas.';
        day.append(empty);
      } else {
        for (const appointment of appointments) {
          const item = document.createElement('article');
          item.className = 'calendar-appointment';
          const title = document.createElement('strong');
          title.textContent = `${formatTime(appointment.appointment_time)} · ${appointment.customer_name}`;
          const meta = document.createElement('span');
          meta.textContent = `${statusName(appointment.status)} · ${appointment.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}`;
          item.append(title, meta);
          const serviceText = (appointment.requested_services || []).map((service) => service.name).filter(Boolean).join(', ');
          if (serviceText) {
            const services = document.createElement('span');
            services.textContent = serviceText;
            item.append(services);
          }
          day.append(item);
        }
      }
      container.append(day);
    }
  } catch (error) {
    if (requestId === calendarLoadRequest) showError(errorElement, error.message);
  }
}
function renderAdminAppointments(pendingAppointments, acceptedAppointments, debts) {
  const activeAppointmentIds = new Set(acceptedAppointments.map((appointment) => appointment.id));
  for (const appointmentId of finishFormStates.keys()) {
    if (!activeAppointmentIds.has(appointmentId)) finishFormStates.delete(appointmentId);
  }
  $('#pending-count').textContent = pendingAppointments.length;
  $('#accepted-count').textContent = acceptedAppointments.length;
  renderAppointmentCards($('#appointment-list'), pendingAppointments, 'No tienes solicitudes pendientes.');
  renderAppointmentCards($('#accepted-appointment-list'), acceptedAppointments, 'Todavía no tienes citas aceptadas.', { canFinalize: true });
  renderDebtCards(debts);
}
function renderAppointmentCards(container, appointments, emptyMessage, options = {}) {
  if (!appointments.length) {
    container.innerHTML = `<div class="empty-list">${emptyMessage}</div>`;
    return;
  }
  const activeElement = container.contains(document.activeElement) ? document.activeElement : null;
  const focusState = activeElement ? {
    appointmentId: activeElement.closest('.finish-form, .reschedule-offer-form')?.dataset.id,
    formSelector: activeElement.closest('.reschedule-offer-form') ? '.reschedule-offer-form' : '.finish-form',
    selector: activeElement.matches('.finish-amount') ? '.finish-amount' : null,
    selectionStart: activeElement.matches('.finish-amount') ? activeElement.selectionStart : null,
    selectionEnd: activeElement.matches('.finish-amount') ? activeElement.selectionEnd : null
  } : null;
  container.replaceChildren();
  appointments.forEach((appointment) => {
    const card = document.createElement('article');
    card.className = 'appointment-card';
    card.dataset.id = appointment.id;
    card.dataset.staffId = appointment.staff_id || '';
    card.dataset.customerName = appointment.customer_name || '';
    card.dataset.customerPhone = appointment.customer_phone || '';
    card.dataset.customerEmail = appointment.customer_email || '';
    card.dataset.appointmentDate = appointment.appointment_date;
    card.dataset.appointmentTime = appointment.appointment_time;
    card.dataset.paymentMethod = appointment.payment_method;
    card.dataset.transferVerificationStatus = appointment.transfer_verification_status || 'not_required';
    card.dataset.delayMinutes = String(appointment.delay_minutes || 0);
    card.dataset.quotedAmount = String(appointment.quoted_amount || 0);
    card.dataset.requestedServices = JSON.stringify(appointment.requested_services || []);
    const actions = appointment.status === 'pending'
      ? `<div class="appointment-actions"><button class="accept-button" data-action="accept" data-id="${appointment.id}">Aceptar</button><button class="reject-button" data-action="reject" data-id="${appointment.id}">Rechazar</button></div>`
      : options.canFinalize
        ? renderFinishActions(appointment, finishFormStates.get(appointment.id))
        : '';
    const remaining = appointment.status === 'pending'
      ? `<div class="response-time"><div class="response-progress" role="progressbar" aria-label="Tiempo restante para responder" aria-valuemin="0" aria-valuemax="100"><span data-expiry-progress data-start="${appointment.created_at}" data-expiry="${appointment.expires_at}"></span></div><div class="state-label" data-start="${appointment.created_at}" data-expiry="${appointment.expires_at}">Calculando tiempo de respuesta…</div></div>`
      : '';
    const services = appointmentServicesMarkup(appointment.requested_services, appointment.quoted_amount);
    const delay = appointment.status === 'accepted' && appointment.delay_minutes
      ? `<div class="state-label">Aviso de retraso enviado: ${appointment.delay_minutes} minutos</div>`
      : '';
    const staffLabel = isShopOwner
      ? `<div class="appointment-meta">${escapeHtml(teamMembers.find((member) => member.id === appointment.staff_id)?.display_name || '')}</div>`
      : '';
    const transferNotice = appointment.status === 'pending' && appointment.transfer_now
      ? '<div class="transfer-pending-notice" role="status"><strong>Transferencia inmediata pendiente de verificar</strong><span>El cliente indicó que transferirá ahora. Revisa el correo y verifica el pago antes de marcarlo como pagado.</span></div>'
      : '';
    const transferVerification = appointment.status === 'accepted' && appointment.payment_method === 'transfer'
      ? `<div class="transfer-verification-controls"><strong>${transferVerificationLabel(appointment.transfer_verification_status)}</strong><div class="appointment-actions"><button class="accept-button" type="button" data-action="verify-transfer" data-id="${appointment.id}">Verificado</button><button class="reject-button" type="button" data-action="unverify-transfer" data-id="${appointment.id}">No verificado</button></div><span>El cliente verá el resultado en vivo en su enlace personal.</span></div>`
      : '';
    const rescheduleOffer = appointment.status === 'accepted'
      ? renderRescheduleOfferForm(appointment)
      : '';
    card.innerHTML = `
      <div class="appointment-main"><div><div class="appointment-time">${formatTime(appointment.appointment_time)}</div><div class="appointment-name">${escapeHtml(appointment.customer_name)}</div><div class="appointment-phone">${escapeHtml(appointment.customer_phone)}</div><div class="appointment-phone">${escapeHtml(appointment.customer_email || 'Sin correo')}</div></div><span class="status-pill ${appointment.status === 'pending' ? 'pending' : 'accepted'}">${statusName(appointment.status)}</span></div>
      <div class="appointment-meta">${appointment.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'} · ${formatBookingDate(appointment.appointment_date)}</div>
      ${staffLabel}${services}${remaining}${delay}${transferNotice}${transferVerification}${rescheduleOffer}${actions}`;
    container.append(card);
  });
  container.querySelectorAll('[data-action="accept"], [data-action="reject"]').forEach((button) => button.addEventListener('click', updateAppointmentStatus));
  container.querySelectorAll('[data-action="show-finish"]').forEach((button) => button.addEventListener('click', showFinishForm));
  container.querySelectorAll('[data-action="mark-paid"], [data-action="mark-debt"]').forEach((button) => button.addEventListener('click', completeAppointment));
  container.querySelectorAll('[data-action="verify-transfer"], [data-action="unverify-transfer"]').forEach((button) => button.addEventListener('click', updateTransferVerification));
  container.querySelectorAll('[data-action="create-reschedule-offer"]').forEach((button) => button.addEventListener('click', createRescheduleOffer));
  container.querySelectorAll('[data-action="cancel-finish"]').forEach((button) => button.addEventListener('click', cancelFinishForm));
  container.querySelectorAll('.finish-amount').forEach((input) => input.addEventListener('input', updateFinishAmount));
  if (focusState?.selector) {
    const restoredFocus = container.querySelector(`${focusState.formSelector}[data-id="${focusState.appointmentId}"] ${focusState.selector}`);
    restoredFocus?.focus({ preventScroll: true });
    if (restoredFocus?.matches('.finish-amount') && Number.isInteger(focusState.selectionStart)) {
      restoredFocus.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
    }
  }
  updateCountdowns();
}
function renderRescheduleOfferForm(appointment) {
  return `<div class="reschedule-offer-form" data-id="${appointment.id}">
    <strong>¿Necesitas cambiar esta cita?</strong>
    <p class="form-note">Barberlink buscará hasta 10 horarios libres durante los próximos 7 días y enviará al cliente un enlace para que elija.</p>
    <button class="quiet-button full-button" type="button" data-action="create-reschedule-offer" data-id="${appointment.id}">Buscar horarios y avisar al cliente</button>
  </div>`;
}
async function createRescheduleOffer(event) {
  const button = event.currentTarget;
  const appointmentId = button.dataset.id;
  button.disabled = true;
  try {
    const { data: offers, error } = await db.rpc('create_appointment_reschedule_offers', {
      p_appointment_id: appointmentId
    });
    if (error) throw error;
    if (!Array.isArray(offers) || !offers.length || !isUuid(offers[0].offer_id)) {
      throw new Error('Supabase no devolvió horarios disponibles para la propuesta.');
    }
    await loadAdminAppointments();
    const { data: notification, error: notifyError } = await db.functions.invoke('notify-reschedule-offer', {
      body: { offer_id: offers[0].offer_id }
    });
    if (notifyError) {
      throw new Error(`Se generaron ${offers.length} horarios, pero no se pudo enviar el aviso: ${await getEdgeFunctionErrorMessage(notifyError, 'notify-reschedule-offer')}. El cliente puede elegir desde su enlace personal.`);
    }
    const sent = Boolean(notification?.email_sent) || Number(notification?.push_sent) > 0;
    if (sent) {
      toast(`Se ofrecieron ${offers.length} horarios y se avisó al cliente con el enlace a su cita.`);
    } else {
      toast(`Se ofrecieron ${offers.length} horarios. No se envió aviso; el cliente debe abrir su enlace personal.`);
    }
  } catch (error) {
    showError($('#admin-error'), error.message);
    button.disabled = false;
  }
}
function renderFinishActions(appointment, state) {
  const appointmentId = appointment.id;
  if (!state?.open) {
    return `<div class="appointment-actions"><button class="accept-button" data-action="show-finish" data-id="${appointmentId}">Finalizar cita</button></div>`;
  }
  const selectedServices = Array.isArray(appointment.requested_services) ? appointment.requested_services : [];
  const serviceName = selectedServices.map((service) => service.name).join(', ');
  const serviceTotal = Number(appointment.quoted_amount) || selectedServices.reduce((sum, service) => sum + Number(service.price), 0);
  return `<div class="appointment-actions">
    <form class="finish-form" data-id="${appointmentId}">
      <p class="form-note">Servicios: ${escapeHtml(serviceName || 'Sin servicios registrados')} · Total estimado: ${formatCurrency(serviceTotal)}</p>
      <label class="field-label">Total a cobrar (COP)
        <input class="finish-amount" type="number" inputmode="numeric" min="1" step="1" placeholder="Ej. 25000" value="${escapeHtml(String(state.amount ?? serviceTotal))}" required>
      </label>
      <div class="appointment-actions">
        <button class="accept-button" type="button" data-action="mark-paid" data-id="${appointmentId}">Pagó · finalizar</button>
        <button class="debt-button" type="button" data-action="mark-debt" data-id="${appointmentId}">Registrar como deuda</button>
      </div>
      <button class="inline-reset-button" type="button" data-action="cancel-finish" data-id="${appointmentId}">Volver</button>
    </form>
  </div>`;
}
function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);
}
function getIncomeDateRange(period) {
  const today = dateInBogota();
  let startDate = today;
  let endDate = shiftDate(today, 1);
  if (period === 'week') {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    startDate = shiftDate(today, -((weekday + 6) % 7));
    endDate = shiftDate(startDate, 7);
  } else if (period === 'month') {
    const [year, month] = today.split('-').map(Number);
    startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = new Date(Date.UTC(year, month, 1));
    endDate = nextMonth.toISOString().slice(0, 10);
  }
  const start = new Date(`${startDate}T00:00:00-05:00`).toISOString();
  const end = new Date(`${endDate}T00:00:00-05:00`).toISOString();
  return { start, end, startDate, endDate };
}
async function loadIncomeSummary() {
  if (!adminBarberProfile) return;
  const requestId = ++incomeLoadRequest;
  const errorElement = $('#income-error');
  errorElement.classList.add('hidden');
  $('#income-total').textContent = '—';
  $('#income-count').textContent = '—';
  $('#income-cash').textContent = '—';
  $('#income-transfer').textContent = '—';
  $('#clear-income-period').disabled = true;
  const { start, end, startDate, endDate } = getIncomeDateRange(incomePeriod);
  const periodLabel = incomePeriod === 'day'
    ? formatBookingDate(startDate)
    : `${formatBookingDate(startDate)} al ${formatBookingDate(shiftDate(endDate, -1))}`;
  $('#income-period-label').textContent = `Pagos recibidos: ${periodLabel}`;
  try {
    const { data, error } = await db.rpc('barber_income_summary', {
      p_start: start,
      p_end: end,
      p_staff_id: adminStaffId
    });
    if (error) throw error;
    if (requestId !== incomeLoadRequest) return;
    const totals = Array.isArray(data) ? data[0] : data;
    $('#income-total').textContent = formatCurrency(Number(totals?.total_amount) || 0);
    const paidAppointments = Number(totals?.paid_appointments) || 0;
    $('#income-count').textContent = String(paidAppointments);
    $('#income-cash').textContent = formatCurrency(Number(totals?.cash_amount) || 0);
    $('#income-transfer').textContent = formatCurrency(Number(totals?.transfer_amount) || 0);
    $('#clear-income-period').disabled = paidAppointments === 0;
  } catch (error) {
    if (requestId === incomeLoadRequest) showError(errorElement, error.message);
  }
}
async function clearIncomePeriod(event) {
  const button = event.currentTarget;
  const { start, end, startDate, endDate } = getIncomeDateRange(incomePeriod);
  const count = Number($('#income-count').textContent);
  const total = $('#income-total').textContent;
  if (!Number.isSafeInteger(count) || count <= 0) return;
  const periodLabel = incomePeriod === 'day'
    ? formatBookingDate(startDate)
    : `${formatBookingDate(startDate)} al ${formatBookingDate(shiftDate(endDate, -1))}`;
  const confirmed = window.confirm(
    `¿Eliminar los ingresos cobrados del período ${periodLabel} (${count} ${count === 1 ? 'cita' : 'citas'}, ${total})?\n\nLas citas no se borrarán, pero quedarán como pendientes de pago y ya no aparecerán en el resumen de ingresos. Esta acción no se puede deshacer.`
  );
  if (!confirmed) return;
  button.disabled = true;
  $('#income-error').classList.add('hidden');
  try {
    const { data, error } = await db.rpc('clear_barber_income_period', {
      p_start: start,
      p_end: end,
      p_staff_id: adminStaffId
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    const clearedCount = Number(result?.cleared_appointments) || 0;
    const clearedAmount = Number(result?.cleared_amount) || 0;
    await loadIncomeSummary();
    toast(`Se quitaron ${clearedCount} ${clearedCount === 1 ? 'ingreso' : 'ingresos'} por ${formatCurrency(clearedAmount)} del resumen.`);
  } catch (error) {
    showError($('#income-error'), error.message);
    button.disabled = false;
  }
}
function renderDebtCards(debts) {
  const container = $('#debt-appointment-list');
  if (!debts.length) {
    container.innerHTML = '<div class="empty-list">No tienes deudas pendientes.</div>';
    return;
  }
  container.replaceChildren();
  debts.forEach((debt) => {
    const card = document.createElement('article');
    card.className = 'appointment-card';
    card.innerHTML = `
      <div class="appointment-main">
        <div><div class="appointment-name">${escapeHtml(debt.customer_name)}</div>
          <div class="appointment-phone">${escapeHtml(debt.customer_phone)}</div></div>
        <span class="status-pill pending">Debe ${formatCurrency(debt.debt_amount)}</span>
      </div>
      <div class="appointment-meta">${formatBookingDate(debt.appointment_date)} · ${formatTime(debt.appointment_time)} · ${debt.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}</div>
      <div class="appointment-actions"><button class="accept-button" data-action="settle-debt" data-id="${debt.id}">Marcar deuda pagada</button></div>`;
    container.append(card);
  });
  container.querySelectorAll('[data-action="settle-debt"]').forEach((button) => button.addEventListener('click', settleDebt));
}
function showFinishForm(event) {
  const button = event.currentTarget;
  const card = button.closest('.appointment-card');
  const services = JSON.parse(card.dataset.requestedServices || '[]');
  const amount = Number(card.dataset.quotedAmount) || services.reduce((sum, service) => sum + Number(service.price), 0);
  finishFormStates.set(button.dataset.id, { open: true, serviceName: services.map((service) => service.name).join(', '), amount });
  renderAdminAppointmentsFromCurrentCards();
  document.querySelector(`#accepted-appointment-list .finish-form[data-id="${button.dataset.id}"] .finish-amount`)?.focus();
}
function updateFinishAmount(event) {
  const input = event.currentTarget;
  const state = finishFormStates.get(input.closest('.finish-form').dataset.id);
  if (state) state.amount = input.value;
}
function cancelFinishForm(event) {
  finishFormStates.delete(event.currentTarget.dataset.id);
  renderAdminAppointmentsFromCurrentCards();
}
function renderAdminAppointmentsFromCurrentCards() {
  const cards = [...$('#accepted-appointment-list').querySelectorAll('.appointment-card')];
  const appointments = cards.map((card) => ({
    id: card.dataset.id,
    staff_id: card.dataset.staffId,
    customer_name: card.dataset.customerName,
    customer_phone: card.dataset.customerPhone,
    customer_email: card.dataset.customerEmail,
    appointment_date: card.dataset.appointmentDate,
    appointment_time: card.dataset.appointmentTime,
    payment_method: card.dataset.paymentMethod,
    transfer_verification_status: card.dataset.transferVerificationStatus,
    requested_services: JSON.parse(card.dataset.requestedServices || '[]'),
    quoted_amount: Number(card.dataset.quotedAmount) || 0,
    status: 'accepted',
    delay_minutes: Number(card.dataset.delayMinutes) || 0
  }));
  renderAppointmentCards($('#accepted-appointment-list'), appointments, 'Todavía no tienes citas aceptadas.', { canFinalize: true });
}
async function updateTransferVerification(event) {
  const button = event.currentTarget;
  const isVerified = button.dataset.action === 'verify-transfer';
  button.disabled = true;
  try {
    const { data, error } = await db.rpc('set_barber_transfer_verification', {
      p_appointment_id: button.dataset.id,
      p_verified: isVerified
    });
    if (error) throw error;
    let message = isVerified ? 'Transferencia marcada como verificada.' : 'Transferencia marcada como no verificada.';
    let emailFailure = '';
    if (isVerified && data === 'verified') {
      try {
        const { data: notification, error: notificationError } = await db.functions.invoke('notify-appointment-update', {
          body: { appointment_id: button.dataset.id, event_type: 'transfer_verified_email' }
        });
        if (notificationError) {
          throw new Error(await getEdgeFunctionErrorMessage(notificationError, 'notify-appointment-update'));
        }
        if (notification?.email_sent) message += ' Se envió un correo al cliente.';
        else if (notification?.already_sent) message += ' El correo de confirmación ya se había enviado.';
      } catch (notificationError) {
        emailFailure = `La transferencia quedó verificada, pero no se pudo enviar el correo al cliente: ${notificationError instanceof Error ? notificationError.message : String(notificationError)}`;
      }
    }
    await loadAdminAppointments();
    if (emailFailure) showError($('#admin-error'), emailFailure);
    else toast(message);
  } catch (error) {
    showError($('#admin-error'), error.message);
    button.disabled = false;
  }
}
async function completeAppointment(event) {
  const button = event.currentTarget;
  const paid = button.dataset.action === 'mark-paid';
  const amountInput = button.closest('.appointment-card').querySelector('.finish-amount');
  const appointmentCard = button.closest('.appointment-card');
  const serviceName = JSON.parse(appointmentCard.dataset.requestedServices || '[]').map((service) => service.name).join(', ') || 'Servicio';
  const amount = Number(amountInput.value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    amountInput.setCustomValidity('Escribe un precio válido, mayor que cero.');
    amountInput.reportValidity();
    return;
  }
  amountInput.setCustomValidity('');
  const confirmation = paid
    ? `¿Confirmas que el cliente pagó ${formatCurrency(amount)} y la cita quedó atendida?`
    : `¿Finalizar la cita y registrar una deuda de ${formatCurrency(amount)}?`;
  if (!window.confirm(confirmation)) return;
  button.disabled = true;
  try {
    const { error } = await db.rpc('complete_barber_appointment', {
      p_appointment_id: button.dataset.id,
      p_paid: paid,
      p_amount_charged: amount,
      p_service_name: serviceName
    });
    if (error) throw error;
    await loadAdminAppointments();
    if (!$('#dashboard-income').classList.contains('hidden')) await loadIncomeSummary();
    toast(paid ? 'Cita finalizada y pago registrado.' : 'Cita finalizada y deuda agregada a la lista.');
  } catch (error) {
    showError($('#admin-error'), error.message);
    button.disabled = false;
  }
}
async function settleDebt(event) {
  const button = event.currentTarget;
  if (!window.confirm('¿Confirmas que esta deuda ya fue pagada?')) return;
  button.disabled = true;
  try {
    const { error } = await db.rpc('settle_barber_debt', { p_appointment_id: button.dataset.id });
    if (error) throw error;
    await loadAdminAppointments();
    if (!$('#dashboard-income').classList.contains('hidden')) await loadIncomeSummary();
    toast('Deuda marcada como pagada.');
  } catch (error) {
    showError($('#admin-error'), error.message);
    button.disabled = false;
  }
}
async function sendDelayNotice(event) {
  const button = event.currentTarget;
  const minutes = Number(button.dataset.delayMinutes);
  const appointmentDate = $('#delay-date').value;
  const status = $('#delay-status');
  const errorMessage = $('#delay-error');
  if (!appointmentDate) {
    showError(errorMessage, 'Selecciona el día de las citas antes de enviar el aviso.');
    return;
  }
  if (!window.confirm(`¿Enviar un aviso de retraso de ${minutes} minutos a las citas aceptadas del ${formatBookingDate(appointmentDate)}?`)) return;
  status.classList.add('hidden');
  errorMessage.classList.add('hidden');
  document.querySelectorAll('[data-delay-minutes]').forEach((option) => { option.disabled = true; });
  try {
    const { data, error } = await db.functions.invoke('send-delay-notifications', {
      body: { delay_minutes: minutes, appointment_date: appointmentDate, staff_id: adminStaffId }
    });
    if (error) {
      throw new Error(await getEdgeFunctionErrorMessage(error, 'send-delay-notifications'));
    }
    if (!data?.updated_count) {
      status.textContent = `No hay citas aceptadas con avisos autorizados para el ${formatBookingDate(appointmentDate)}.`;
    } else {
      status.textContent = `Aviso publicado para ${data.updated_count} ${data.updated_count === 1 ? 'cita aceptada' : 'citas aceptadas'} del ${formatBookingDate(appointmentDate)}. Correos enviados: ${data.email_sent}. Push enviados: ${data.push_sent}.`;
      if (data.email_failed || data.push_failed || data.warnings?.length) {
        status.textContent += ` No se pudieron enviar ${data.email_failed || 0} correo(s) y ${data.push_failed || 0} notificación(es).`;
        if (data.warnings?.length) status.textContent += ` ${data.warnings.join(' ')}`;
      }
      await loadAdminAppointments();
    }
    status.classList.remove('hidden');
  } catch (error) {
    showError(errorMessage, error.message);
  } finally {
    document.querySelectorAll('[data-delay-minutes]').forEach((option) => { option.disabled = false; });
  }
}
function updateCountdowns() {
  document.querySelectorAll('[data-expiry]').forEach((element) => {
    const expiry = new Date(element.dataset.expiry).getTime();
    const start = new Date(element.dataset.start).getTime();
    if (!Number.isFinite(expiry) || !Number.isFinite(start)) return;
    const deadline = Math.max(expiry, start + MIN_APPOINTMENT_RESPONSE_SECONDS * 1000);
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const timeLabel = minutes ? `${minutes} min ${seconds} s` : `${seconds} s`;
    element.textContent = remaining ? `Tiempo para responder: ${timeLabel}` : 'Tiempo agotado · liberando espacio…';
  });
  document.querySelectorAll('[data-expiry-progress]').forEach((bar) => {
    const start = new Date(bar.dataset.start).getTime();
    const expiry = new Date(bar.dataset.expiry).getTime();
    if (!Number.isFinite(expiry) || !Number.isFinite(start)) return;
    const deadline = Math.max(expiry, start + MIN_APPOINTMENT_RESPONSE_SECONDS * 1000);
    const duration = Math.max(1, deadline - start);
    const remaining = Math.max(0, deadline - Date.now());
    const percentage = Math.max(0, Math.min(100, remaining / duration * 100));
    bar.style.width = `${percentage}%`;
    bar.parentElement.setAttribute('aria-valuenow', String(Math.round(percentage)));
    bar.parentElement.classList.toggle('urgent', percentage <= 20);
  });
}
async function updateAppointmentStatus(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    const { data, error } = await db.rpc('respond_to_appointment', {
      appointment_id: button.dataset.id,
      accept_request: action === 'accept'
    });
    if (error) throw error;
    let message = data === 'expired' ? 'El tiempo terminó y el espacio quedó libre.' : action === 'accept' ? 'Cita aceptada.' : 'Solicitud rechazada.';
    let pushFailure = '';
    let notificationStatus = '';
    if (action === 'accept' && data === 'accepted') {
      try {
        const { data: notification, error: notificationError } = await db.functions.invoke('notify-appointment-update', {
          body: { appointment_id: button.dataset.id, event_type: 'accepted_push' }
        });
        if (notificationError) {
          throw new Error(await getEdgeFunctionErrorMessage(notificationError, 'notify-appointment-update'));
        }
        if (notification?.push_sent > 0) message += ' Se envió el aviso push al cliente.';
        else if (notification?.consent_missing) message += ' Esta reserva no tiene activada la autorización para recibir notificaciones push.';
        else if (notification?.no_subscription) message += ' El cliente no tiene un dispositivo push registrado para esta cita.';
        else if (notification?.already_sent) message += ' El aviso push ya se había enviado.';
        else if (notification?.push_failed > 0) {
          message += ` No se pudo entregar el aviso push.${notification.warnings?.length ? ` ${notification.warnings.join(' ')}` : ''}`;
        } else {
          message += ' No se confirmó el envío del aviso push; revisa la suscripción del cliente y los logs de la Edge Function.';
        }
        notificationStatus = message;
      } catch (notificationError) {
        pushFailure = `La cita quedó aceptada, pero no se pudo enviar el aviso push: ${notificationError instanceof Error ? notificationError.message : String(notificationError)}`;
        notificationStatus = pushFailure;
      }
    } else if (action === 'accept') {
      notificationStatus = `La cita respondió «${data || 'sin estado'}»; no se solicitó el push de aceptación.`;
    }
    await loadAdminAppointments();
    if (action === 'accept') {
      const status = $('#appointment-notification-status');
      status.textContent = notificationStatus;
      status.classList.remove('hidden');
    }
    if (pushFailure) showError($('#admin-error'), pushFailure);
    else toast(message);
  } catch (error) {
    showError($('#admin-error'), error.message);
    button.disabled = false;
  }
}
async function toggleOpen(event) {
  const toggle = event.currentTarget;
  toggle.disabled = true;
  $('#open-error').classList.add('hidden');
  try {
    const { data, error } = await db.from('barber_profiles').update({ is_open: toggle.checked })
      .eq('id', adminBarberProfile.id).select('id, is_open').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No se actualizó la barbería. Verifica que tu cuenta esté agregada al equipo y vuelve a iniciar sesión.');
    toggle.checked = data.is_open;
    $('#open-label').textContent = data.is_open ? 'Abierta' : 'Cerrada';
    toast(data.is_open ? 'Agenda abierta para nuevas citas.' : 'Agenda cerrada.');
  } catch (error) {
    toggle.checked = !toggle.checked;
    showError($('#open-error'), error.message);
  } finally {
    toggle.disabled = false;
  }
}
function subscribeDashboard() {
  if (dashboardChannel) return;
  dashboardChannel = db.channel('barber-dashboard')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, loadAdminAppointments)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'barber_profiles' }, (payload) => {
      const profile = payload.new;
      if (!profile || profile.id !== adminBarberProfile?.id) return;
      Object.assign(adminBarberProfile, profile);
      if (typeof profile.is_open === 'boolean') {
        $('#open-toggle').checked = profile.is_open;
        $('#open-label').textContent = profile.is_open ? 'Abierta' : 'Cerrada';
      }
    })
    .subscribe();
}
function stopDashboardUpdates() {
  window.clearInterval(refreshTimer);
  if (dashboardChannel) db.removeChannel(dashboardChannel);
  dashboardChannel = null;
}
function connectAppointmentLive() {
  window.clearInterval(personalRefreshTimer);
  personalRefreshTimer = window.setInterval(loadPersonalAppointment, 5000);
}
function start() {
  $('#year').textContent = new Date().getFullYear();
  document.querySelectorAll('.current-year').forEach((element) => { element.textContent = new Date().getFullYear(); });
  const soundCheckbox = $('#notification-sound-enabled');
  soundCheckbox.checked = localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY) === 'true';
  soundCheckbox.addEventListener('change', () => setNotificationSoundEnabled(soundCheckbox.checked));
  const newAppointmentSoundCheckbox = $('#new-appointment-sound-enabled');
  newAppointmentSoundCheckbox.checked = localStorage.getItem(NEW_APPOINTMENT_SOUND_STORAGE_KEY) === 'true';
  newAppointmentSoundCheckbox.addEventListener('change', () => setNewAppointmentSoundEnabled(newAppointmentSoundCheckbox.checked));
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'BARBERLINK_PUSH_RECEIVED') {
        playNotificationSound().catch((error) => console.error('No se pudo reproducir el sonido de notificación:', error));
      }
    });
  }
  if (soundCheckbox.checked || newAppointmentSoundCheckbox.checked) {
    const unlockSavedSound = () => {
      if (notificationSoundContext) return;
      if (localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY) === 'true') {
        prepareNotificationSound().catch((error) => {
          $('#notification-sound-status').textContent = `No se pudo preparar el sonido: ${error instanceof Error ? error.message : String(error)}`;
        });
      }
      if (localStorage.getItem(NEW_APPOINTMENT_SOUND_STORAGE_KEY) === 'true') {
        prepareNewAppointmentSound().catch((error) => {
          $('#new-appointment-sound-status').textContent = `No se pudo preparar la alerta: ${error instanceof Error ? error.message : String(error)}`;
        });
      }
    };
    document.addEventListener('pointerdown', unlockSavedSound, { once: true });
    document.addEventListener('keydown', unlockSavedSound, { once: true });
  }
  const today = dateInBogota();
  $('#appointment-date').min = today;
  $('#appointment-date').value = today;
  $('#admin-date').value = today;
  $('#admin-date').min = today;
  $('#delay-date').value = today;
  $('#delay-date').min = today;
  $('#schedule-date').value = today;
  $('#schedule-date').min = today;
  $('#break-date').value = today;
  $('#break-date').min = today;
  $('#schedule-weekdays input[value="1"]').checked = true;
  createTwelveHourPicker($('#schedule-open-time'));
  createTwelveHourPicker($('#schedule-close-time'));
  $('#appointment-date').addEventListener('change', loadSlots);
  $('#booking-form').addEventListener('submit', submitBooking);
  $('#payment-method').addEventListener('change', updateTransferTimingVisibility);
  $('#close-transfer-dialog').addEventListener('click', () => $('#transfer-details-dialog').close());
  $('#login-form').addEventListener('submit', signIn);
  $('#forgot-password').addEventListener('click', () => {
    $('#login-panel').classList.add('hidden');
    $('#password-reset-panel').classList.remove('hidden');
    $('#password-reset-request-form').classList.remove('hidden');
    $('#password-update-form').classList.add('hidden');
    $('#password-reset-title').textContent = 'Restablecer contraseña';
    $('#password-reset-description').textContent = 'Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.';
    $('#recovery-email').value = $('#login-email').value;
    $('#password-reset-message').classList.add('hidden');
    $('#password-reset-error').classList.add('hidden');
  });
  $('#back-to-login').addEventListener('click', () => {
    $('#password-reset-panel').classList.add('hidden');
    $('#login-panel').classList.remove('hidden');
  });
  $('#password-reset-request-form').addEventListener('submit', requestPasswordReset);
  $('#password-update-form').addEventListener('submit', updatePassword);
  $('#admin-date').addEventListener('change', loadAdminAppointments);
  $('#admin-date').addEventListener('change', () => {
    $('#schedule-date').value = $('#admin-date').value;
    loadScheduleEditor();
  });
  $('#schedule-mode').addEventListener('change', loadScheduleEditor);
  $('#schedule-weekdays').addEventListener('change', (event) => {
    if (event.target.checked && selectedWeekdays().length === 1) loadScheduleEditor();
    $('#schedule-error').classList.add('hidden');
  });
  $('#schedule-date').addEventListener('change', loadScheduleEditor);
  $('#break-date').addEventListener('change', () => loadBreaks($('#break-date').value));
  $('#save-schedule').addEventListener('click', saveSchedule);
  $('#save-slot-duration').addEventListener('click', saveSlotDuration);
  $('#save-transfer-details').addEventListener('click', saveTransferDetails);
  $('#save-public-profile').addEventListener('click', savePublicProfile);
  $('#download-profile-qr').addEventListener('click', downloadPublicProfileQr);
  $('#add-break').addEventListener('click', addBreak);
  $('#clear-date-schedule').addEventListener('click', clearDateSchedule);
  calendarWeekStart = getWeekStart(today);
  $('#calendar-prev-week').addEventListener('click', () => {
    calendarWeekStart = shiftDate(calendarWeekStart, -7);
    loadCalendarWeek();
  });
  $('#calendar-next-week').addEventListener('click', () => {
    calendarWeekStart = shiftDate(calendarWeekStart, 7);
    loadCalendarWeek();
  });
  $('#calendar-today').addEventListener('click', () => {
    calendarWeekStart = getWeekStart(dateInBogota());
    loadCalendarWeek();
  });
  $('#open-toggle').addEventListener('change', toggleOpen);
  $('#refresh-button').addEventListener('click', loadAdminAppointments);
  $('#refresh-income').addEventListener('click', loadIncomeSummary);
  $('#clear-income-period').addEventListener('click', clearIncomePeriod);
  document.querySelectorAll('[data-income-period]').forEach((button) => {
    button.addEventListener('click', () => {
      incomePeriod = button.dataset.incomePeriod;
      document.querySelectorAll('[data-income-period]').forEach((periodButton) => {
        const selected = periodButton === button;
        periodButton.classList.toggle('active', selected);
        periodButton.setAttribute('aria-pressed', String(selected));
      });
      loadIncomeSummary();
    });
  });
  $('#delay-date').addEventListener('change', () => {
    $('#delay-status').classList.add('hidden');
    $('#delay-error').classList.add('hidden');
  });
  document.querySelectorAll('.dashboard-nav [data-dashboard-section]').forEach((button) => {
    button.addEventListener('click', () => setDashboardSection(button.dataset.dashboardSection));
  });
  $('#add-transfer-method').addEventListener('click', () => addTransferMethod());
  $('#add-service').addEventListener('click', addService);
  $('#admin-staff').addEventListener('change', async (event) => {
    adminStaffId = event.currentTarget.value;
    loadSelectedStaffSettings();
    await refreshSelectedStaff();
  });
  $('#booking-staff').addEventListener('change', () => {
    staffSlugRoute = $('#booking-staff').value || null;
    selectedTime = null;
    $('#booking-form-wrap').classList.add('hidden');
    $('#slots').replaceChildren();
    setBookingServicesForStaff();
    renderBookingServices();
    renderBookingServiceTotal();
    const url = new URL('./', window.location.href);
    if (barberSlug) url.searchParams.set('barber', barberSlug);
    if (staffSlugRoute) url.searchParams.set('staff', staffSlugRoute);
    history.replaceState({}, '', url);
    if ($('#appointment-date').value) loadSlots();
    else $('#slot-help').textContent = 'Elige una fecha para ver los horarios';
  });
  document.querySelectorAll('.dashboard-refresh-button').forEach((button) => {
    button.addEventListener('click', loadAdminAppointments);
  });
  document.querySelectorAll('[data-delay-minutes]').forEach((button) => button.addEventListener('click', sendDelayNotice));
  $('#directory-entry').addEventListener('click', () => {
    closeTopbarMenu();
    setBarberRoute(null);
    showView('directory');
    loadBarberDirectory();
  });
  $('#booking-entry').addEventListener('click', async () => {
    closeTopbarMenu();
    const targetSlug = barberSlug || adminBarberProfile?.slug;
    if (!targetSlug) {
      showView('directory');
      await loadBarberDirectory();
      return;
    }
    if (targetSlug !== barberSlug) setBarberRoute(targetSlug);
    showView('booking');
    try {
      await loadPublicConfig();
      await loadSlots();
    } catch (error) {
      showError($('#public-error'), error.message);
    }
  });
  $('#personal-appointment-entry').addEventListener('click', openPersonalAppointment);
  $('#admin-entry').addEventListener('click', async () => {
    closeTopbarMenu();
    platformAdminRequested = false;
    $('#platform-admin-panel').classList.add('hidden');
    showView('admin');
    if (db) await checkSession();
  });
  $('#platform-admin-entry').addEventListener('click', async () => {
    closeTopbarMenu();
    platformAdminRequested = true;
    showView('admin');
    $('#platform-admin-panel').classList.add('hidden');
    $('#platform-admin-tools').classList.add('hidden');
    if (db) await checkSession();
  });
  $('#platform-admin-barber').addEventListener('change', () => {
    loadPlatformAdminTeam().catch((error) => showError($('#platform-admin-error'), error.message));
  });
  $('#platform-admin-add-member').addEventListener('click', addPlatformAdminMember);
  $('#platform-admin-delete-shop').addEventListener('click', deletePlatformAdminBarbershop);
  $('#platform-admin-create-shop').addEventListener('click', createPlatformBarbershop);
  $('#platform-admin-shop-name').addEventListener('input', (event) => {
    const slugInput = $('#platform-admin-shop-slug');
    if (!slugInput.dataset.edited) slugInput.value = slugifyBarbershopName(event.currentTarget.value);
  });
  $('#platform-admin-shop-slug').addEventListener('input', (event) => {
    event.currentTarget.dataset.edited = event.currentTarget.value ? 'true' : '';
  });
  $('#menu-toggle').addEventListener('click', toggleTopbarMenu);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.topbar-menu')) closeTopbarMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTopbarMenu();
  });
  $('#logout-button').addEventListener('click', async () => {
    const { error } = await db.auth.signOut();
    if (error) {
      showError($('#admin-error'), error.message);
      return;
    }
    closeTopbarMenu();
    stopDashboardUpdates();
    $('#logout-button').classList.add('hidden');
    $('#login-panel').classList.remove('hidden');
    $('#dashboard').classList.add('hidden');
    $('#platform-admin-panel').classList.add('hidden');
    platformAdminRequested = false;
    isPlatformAdmin = false;
    toast('Sesión cerrada.');
  });
  $('#home-link').addEventListener('click', (event) => {
    event.preventDefault();
    setBarberRoute(null);
    window.clearInterval(personalRefreshTimer);
    showView('directory');
    loadBarberDirectory();
  });
  updateBookingEntry();
  setDashboardSection(activeDashboardSection);
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((error) => console.error('No se pudo instalar el service worker:', error)));
  if (db) {
    db.auth.onAuthStateChange((event, session) => {
      $('#logout-button').classList.toggle('hidden', !session);
      if (event === 'PASSWORD_RECOVERY') {
        showPasswordReset();
        return;
      }
      if (activeView === 'admin') {
        $('#login-panel').classList.toggle('hidden', !!session);
        $('#dashboard').classList.toggle('hidden', !session);
        if (session) loadDashboard();
        else stopDashboardUpdates();
      }
    });
    const token = new URLSearchParams(window.location.search).get('cita');
    const openAdminPanel = new URLSearchParams(window.location.search).get('panel') === '1';
    if (token) {
      appointmentToken = token;
      $('#personal-appointment-entry').classList.remove('hidden');
      showView('appointment');
      loadPersonalAppointment();
      connectAppointmentLive();
    } else if (openAdminPanel) {
      showView('admin');
      checkSession();
    } else if (barberSlug) {
      showView('booking');
      loadPublicConfig().then(loadSlots).catch((error) => showError($('#public-error'), error.message));
    } else {
      showView('directory');
      loadBarberDirectory();
    }
  } else {
    showError($('#public-error'), 'Para activar la agenda conecta tu proyecto Supabase. Revisa los pasos de instalación en README.md.');
  }
  window.setInterval(updateCountdowns, 1000);
}
document.addEventListener('DOMContentLoaded', start);
