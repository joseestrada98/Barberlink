/* Configure these with the public URL and anon key from your Supabase project. */
const SUPABASE_URL = 'https://byhgolgveshqgeqmnrks.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mqRwxk1f7L_M1QYJt3UVEw_qnM4DOYg';
const WEB_PUSH_PUBLIC_KEY = 'BFSsXqTzyESC5k3FCAFSc8Zu4dC95huN2vN_jDxUHxIIG2oLjlfE016hx3IzCnyaF2gjSA2g2mbPAkAvGviGkDE';
const MIN_APPOINTMENT_RESPONSE_SECONDS = 600;
const supabaseReady = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('PEGA_AQUI') && !SUPABASE_ANON_KEY.includes('PEGA_AQUI');
const db = supabaseReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (selector) => document.querySelector(selector);
function createUuid() {
  const webCrypto = window.crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error('Este navegador no permite generar identificadores seguros. Abre la página con una versión actualizada de Chrome o Edge.');
  }
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
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
let adminAppointmentsLoadRequest = 0;
let scheduleLoadRequest = 0;
const finishFormStates = new Map();
let incomePeriod = 'day';
let incomeLoadRequest = 0;
let calendarLoadRequest = 0;
const dashboardSections = ['today', 'requests', 'accepted', 'calendar', 'debts', 'income', 'schedule', 'transfer-settings'];
let transferMethodState = [];
let serviceCatalogState = [];
let publicGalleryState = [];
let publicServiceCatalog = [];
let currentPublicConfig = null;
let bookingWeekStart = null;
let profileSaveRequest = 0;
let activeDashboardSection = 'today';
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
  } else if (description.includes('mark_barber_appointment_no_show') || description.includes('appointments_status_check')) {
    friendlyMessage = `No se pudo actualizar la cita «No llegó». Ejecuta completo el archivo supabase-next-features.sql en Supabase → SQL Editor y vuelve a intentarlo. Detalle: ${description}`;
  } else if (description.includes('block_barber_calendar_slot')) {
    friendlyMessage = `No se pudo bloquear el horario. Ejecuta completo el archivo supabase-next-features.sql actualizado en Supabase → SQL Editor y vuelve a intentarlo. Detalle: ${description}`;
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
  } else if (description.includes('submit_appointment_transfer_proof') || description.includes('transfer_proof_path') || description.includes('transfer_payment_required') || description.includes('deposit_amount_due') || description.includes('deposit_enabled') || description.includes('deposit_type') || description.includes('appointment-payment-proofs')) {
    friendlyMessage = 'Falta aplicar supabase-transfer-deposits.sql en Supabase → SQL Editor. Revisa las instrucciones de README.md y vuelve a cargar la página.';
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
  } else if (description.includes('public_gallery') || description.includes('barber-profile-gallery')) {
    friendlyMessage = 'Falta actualizar la galería pública en Supabase. Ejecuta el archivo actualizado supabase-weekly-agenda.sql completo y vuelve a cargar la página.';
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
  renderBookingServiceTotal();
}
function bookingWeekLimit() {
  const today = dateInBogota();
  const currentWeekStart = getWeekStart(today);
  const currentWeekEnd = shiftDate(currentWeekStart, 7);
  return {
    today,
    currentWeekStart,
    currentWeekEnd,
    nextWeekAllowed: new Date(`${today}T12:00:00Z`).getUTCDay() === 0,
    maxDate: new Date(`${today}T12:00:00Z`).getUTCDay() === 0
      ? shiftDate(currentWeekEnd, 6)
      : shiftDate(currentWeekEnd, -1)
  };
}
function renderBookingWeekPicker() {
  const picker = $('#booking-week-days');
  if (!picker) return;
  const limits = bookingWeekLimit();
  if (!bookingWeekStart) bookingWeekStart = limits.currentWeekStart;
  if (bookingWeekStart > limits.currentWeekStart && !limits.nextWeekAllowed) {
    bookingWeekStart = limits.currentWeekStart;
  }
  const weekEndDate = shiftDate(bookingWeekStart, 6);
  $('#booking-week-label').textContent = `${formatBookingDate(bookingWeekStart)} – ${formatBookingDate(weekEndDate)}`;
  const showingNextWeek = bookingWeekStart > limits.currentWeekStart;
  $('#booking-prev-week').disabled = !showingNextWeek;
  $('#booking-next-week').disabled = !limits.nextWeekAllowed || showingNextWeek;
  $('#booking-week-note').textContent = limits.nextWeekAllowed
    ? 'El barbero ya puede organizar la próxima semana. Elige un día para consultar sus horarios.'
    : 'Puedes reservar para esta semana. La próxima semana se habilita el domingo.';
  picker.replaceChildren();
  for (let offset = 0; offset < 7; offset += 1) {
    const date = shiftDate(bookingWeekStart, offset);
    const day = new Date(`${date}T12:00:00Z`);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'booking-day-button';
    button.setAttribute('aria-pressed', String($('#appointment-date').value === date));
    button.disabled = date < limits.today || date > limits.maxDate;
    if ($('#appointment-date').value === date) button.classList.add('selected');
    const weekday = document.createElement('span');
    weekday.className = 'booking-day-name';
    weekday.textContent = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'short' }).format(day).replace('.', '');
    const dayNumber = document.createElement('strong');
    dayNumber.textContent = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit' }).format(day);
    const month = document.createElement('span');
    month.className = 'booking-day-month';
    month.textContent = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'short' }).format(day).replace('.', '');
    button.append(weekday, dayNumber, month);
    button.addEventListener('click', () => {
      $('#appointment-date').value = date;
      renderBookingWeekPicker();
      loadSlots();
    });
    picker.append(button);
  }
}
function selectBookingWeek(weekStart) {
  const limits = bookingWeekLimit();
  bookingWeekStart = weekStart;
  const weekEnd = shiftDate(weekStart, 6);
  const minDate = weekStart > limits.currentWeekStart ? weekStart : limits.today;
  const maxDate = weekEnd < limits.maxDate ? weekEnd : limits.maxDate;
  const selectedDate = $('#appointment-date').value;
  if (selectedDate < minDate || selectedDate > maxDate) $('#appointment-date').value = minDate;
  renderBookingWeekPicker();
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
  const galleryItems = [...new Map((config.staff || [])
    .flatMap((staff) => (Array.isArray(staff.gallery) ? staff.gallery : [])
      .filter((path) => typeof path === 'string')
      .map((path) => ({
        imageUrl: safePublicImageUrl(db.storage.from('barber-profile-gallery').getPublicUrl(path).data.publicUrl),
        staffName: staff.name || ''
      })))
    .filter((item) => item.imageUrl)
    .map((item) => [item.imageUrl, item])).values()];
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
    ${galleryItems.length ? `<section class="public-barber-gallery" aria-label="Galería de fotos de la barbería">
      <div class="public-barber-gallery-heading"><strong>Galería de trabajos</strong><span>Desliza para ver las fotos</span></div>
      <div class="public-barber-gallery-track">${galleryItems.map((item) => `<button class="public-barber-gallery-item" type="button" aria-label="Ampliar foto de ${escapeHtml(item.staffName || 'la barbería')}" data-gallery-image="${escapeHtml(item.imageUrl)}" data-gallery-caption="${escapeHtml(item.staffName || 'Trabajo de la barbería')}">
        <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(`Trabajo de ${item.staffName || 'la barbería'}`)}" loading="lazy">
        <span class="public-barber-gallery-item-caption">${escapeHtml(item.staffName || 'Trabajo de la barbería')}</span>
      </button>`).join('')}</div>
    </section>` : ''}
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
  container.querySelectorAll('[data-gallery-image]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = $('#public-gallery-dialog');
      const image = $('#public-gallery-dialog-image');
      image.src = button.dataset.galleryImage;
      image.alt = button.querySelector('img').alt;
      $('#public-gallery-dialog-caption').textContent = button.dataset.galleryCaption;
      dialog.showModal();
    });
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
  renderBookingWeekPicker();
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
function openNavigationGuide() {
  closeTopbarMenu();
  const dialog = $('#navigation-guide-dialog');
  if (!dialog.open) dialog.showModal();
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
  $('#selected-slot-summary').classList.add('hidden');
  $('#slots').replaceChildren();
  if (!date) return;
  const limits = bookingWeekLimit();
  if (date < limits.today || date > limits.maxDate) {
    $('#slot-help').textContent = 'Elige una fecha de esta semana. La próxima se habilita el domingo.';
    return;
  }
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
        selectBookingWeek(getWeekStart(nextDate));
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
        $('#selected-slot-summary').classList.remove('hidden');
      });
      $('#slots').append(button);
    });
  } catch (error) {
    $('#slot-help').textContent = 'No fue posible cargar los horarios';
    showError($('#public-error'), error.message);
  }
}
function setBookingStep(step) {
  const detailsStep = step === 'details';
  $('#booking-step-details').classList.toggle('hidden', !detailsStep);
  $('#booking-step-schedule').classList.toggle('hidden', detailsStep);
  $('#booking-step-indicator').textContent = detailsStep ? 'Paso 1 de 2' : 'Paso 2 de 2';
  $('#booking-step-description').textContent = detailsStep ? 'Servicios y tus datos' : 'Fecha, hora y avisos';
  $('#public-error').classList.add('hidden');
}
function advanceBookingStep() {
  if (!$('#booking-staff').value) {
    $('#booking-staff').reportValidity();
    return;
  }
  if (!selectedBookingServices().length) {
    showError($('#public-error'), 'Selecciona al menos un servicio antes de continuar.');
    $('#booking-services').querySelector('input')?.focus();
    return;
  }
  const requiredFields = ['#customer-name', '#customer-phone', '#customer-email', '#payment-method'];
  for (const selector of requiredFields) {
    const field = $(selector);
    if (!field.reportValidity()) return;
  }
  if ($('#payment-method').value === 'transfer' && !$('#transfer-timing').reportValidity()) return;
  setBookingStep('schedule');
  loadSlots();
  $('#booking-step-schedule').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderBookingResult(appointment, notificationsEnabled, pushMessage) {
  const personalUrl = new URL('./', window.location.href);
  const staffId = $('#booking-staff').value;
  personalUrl.searchParams.set('barber', barberSlug);
  personalUrl.searchParams.set('staff', staffId);
  personalUrl.searchParams.set('cita', appointment.access_token);
  const selectedStaff = publicStaffList.find((staff) => staff.id === staffId);
  const bookingTotal = selectedBookingServices().reduce((sum, service) => sum + Number(service.price), 0);
  const requiresTransferPayment = $('#payment-method').value === 'transfer' || Boolean(selectedStaff?.deposit_enabled);
  const isDeposit = Boolean(selectedStaff?.deposit_enabled) && $('#payment-method').value !== 'transfer';
  const requiredTransferAmount = isDeposit
    ? selectedStaff.deposit_type === 'fixed' ? Math.min(5000, bookingTotal) : Math.ceil(bookingTotal / 2)
    : bookingTotal;
  appointmentToken = appointment.access_token;
  $('#personal-appointment-entry').classList.remove('hidden');
  const notificationMessage = notificationsEnabled
    ? `Aceptaste recibir avisos por correo.${pushMessage ? ` ${escapeHtml(pushMessage)}` : ' Cuando el barbero acepte, recibirás un aviso push. Puedes dejar esta ventana en segundo plano y mantener activadas las notificaciones para enterarte.'}`
    : 'Elegiste no recibir avisos automáticos. Consulta los cambios desde tu enlace personal.';
  $('#appointment-result').innerHTML = `
    <div class="success-card">
      <h3>Solicitud enviada</h3>
      <p>Solicitaste una cita con ${escapeHtml(selectedStaff?.name || 'tu barbero')}. Tu espacio está reservado temporalmente mientras responde. Guarda este enlace para consultar el estado.</p>
      ${requiresTransferPayment ? `<p class="transfer-pending-notice"><strong>${isDeposit ? 'Debes pagar el anticipo por transferencia' : 'Debes realizar el pago total por transferencia'}</strong><span>Valor: ${formatCurrency(requiredTransferAmount)}${isDeposit ? ` de ${formatCurrency(bookingTotal)}; el saldo de ${formatCurrency(bookingTotal - requiredTransferAmount)} se paga en efectivo al finalizar` : ''}. Después de transferir, toma una captura de pantalla del comprobante y envíala desde el enlace de tu cita para que el barbero pueda verificar el pago.</span></p>` : ''}
      <a class="personal-link" href="${personalUrl.href}">${personalUrl.href}</a>
      ${requiresTransferPayment ? '<p class="form-note"><strong>Recuerda:</strong> debes enviar la captura de la transferencia desde este enlace. La cita requiere el comprobante para que el barbero confirme el pago.</p>' : ''}
      <p id="booking-notification-message" class="form-note">${notificationMessage}</p>
      <button id="retry-push-registration" class="quiet-button full-button hidden" type="button">Reintentar notificaciones push</button>
      <p style="margin-top:13px;margin-bottom:0">Tu enlace es personal. No lo compartas con otras personas.</p>
    </div>`;
  $('#retry-push-registration').addEventListener('click', retryAppointmentPush);
  $('#appointment-result').classList.remove('hidden');
  $('#booking-form').reset();
  $('#notification-sound-enabled').checked = localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY) === 'true';
  renderBookingServices();
  renderBookingServiceTotal();
  updateTransferTimingVisibility();
  setBookingStep('details');
  selectedTime = null;
  $('#selected-slot-summary').classList.add('hidden');
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
  const serviceTotal = selected.reduce((sum, service) => sum + Number(service.price), 0);
  total.textContent = selected.length ? `Total estimado: ${formatCurrency(serviceTotal)}` : '';
  total.classList.toggle('hidden', selected.length === 0);
  const transferSummary = $('#booking-transfer-summary');
  if (!transferSummary) return;
  const isTransfer = $('#payment-method').value === 'transfer';
  const staff = publicStaffList.find((member) => member.id === $('#booking-staff').value);
  const depositEnabled = Boolean(staff?.deposit_enabled);
  const requiresTransferPayment = isTransfer || depositEnabled;
  const isDeposit = depositEnabled && !isTransfer;
  const amountDue = isDeposit
    ? staff.deposit_type === 'fixed' ? Math.min(5000, serviceTotal) : Math.ceil(serviceTotal / 2)
    : serviceTotal;
  transferSummary.innerHTML = requiresTransferPayment && selected.length
    ? `<strong>${isDeposit ? 'Anticipo obligatorio por transferencia' : 'Pago total por transferencia'}: ${formatCurrency(amountDue)}</strong>${isDeposit ? `<span> de ${formatCurrency(serviceTotal)}; el saldo se paga en efectivo al finalizar.</span>` : ''}<span>Los datos para transferir aparecerán al enviar la solicitud.</span>`
    : '';
  transferSummary.classList.toggle('hidden', !requiresTransferPayment || !selected.length);
}
function renderBookingServices() {
  const container = $('#booking-services');
  if (!container) return;
  container.replaceChildren();
  const help = $('#booking-services-help');
  if (!$('#booking-staff').value) {
    help.textContent = 'Primero selecciona un barbero para ver sus servicios y precios.';
    $('#booking-next-step').disabled = true;
    return;
  }
  if (!publicServiceCatalog.length) {
    help.textContent = 'Esta barbería todavía no publicó servicios. Comunícate con el barbero para solicitar una cita.';
    $('#booking-next-step').disabled = true;
    return;
  }
  help.textContent = 'Selecciona uno o varios servicios. El barbero confirmará el total al finalizar la cita.';
  $('#booking-next-step').disabled = false;
  publicServiceCatalog.forEach((service) => {
    const label = document.createElement('label');
    label.className = 'booking-service-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = service.id;
    checkbox.addEventListener('change', renderBookingServiceTotal);
    const details = document.createElement('span');
    details.className = 'booking-service-details';
    const name = document.createElement('strong');
    name.textContent = service.name;
    const price = document.createElement('span');
    price.textContent = formatCurrency(Number(service.price));
    details.append(name, price);
    label.append(checkbox, details);
    container.append(label);
  });
}
function safePublicImageUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
function isProfileGalleryPath(path, barberId, staffId) {
  const parts = typeof path === 'string' ? path.split('/') : [];
  return parts.length === 4
    && parts[0] === barberId
    && parts[1] === staffId
    && parts[2] === 'gallery'
    && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.(jpg|png|webp)$/i.test(parts[3]);
}
function updateTransferTimingVisibility() {
  const isTransfer = $('#payment-method').value === 'transfer';
  const timingWrap = $('#transfer-timing-wrap');
  const timingSelect = $('#transfer-timing');
  timingWrap.classList.toggle('hidden', !isTransfer);
  timingSelect.required = isTransfer;
  if (!isTransfer) timingSelect.value = '';
  renderBookingServiceTotal();
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
async function showTransferDetails(appointment, emailNotice, staffId) {
  const { data, error } = await db.rpc('public_appointment_by_token', { token: appointment.access_token });
  if (error) throw error;
  const savedAppointment = Array.isArray(data) ? data[0] : data;
  if (!savedAppointment) throw new Error('No pudimos cargar los datos de transferencia. Consulta tu cita desde el enlace personal.');
  const personalUrl = new URL('./', window.location.href);
  personalUrl.searchParams.set('barber', barberSlug);
  personalUrl.searchParams.set('staff', staffId);
  personalUrl.searchParams.set('cita', appointment.access_token);
  const transferAmount = savedAppointment.deposit_amount_due || savedAppointment.quoted_amount;
  const transferLabel = transferAmount < savedAppointment.quoted_amount ? 'Anticipo a transferir' : 'Total a transferir';
  const transferBreakdown = transferAmount < savedAppointment.quoted_amount
    ? `<p class="form-note">Total del servicio: ${formatCurrency(savedAppointment.quoted_amount)}. Saldo pendiente: ${formatCurrency(savedAppointment.quoted_amount - transferAmount)}, para pagar en efectivo al finalizar.</p>`
    : '';
  $('#transfer-dialog-details').innerHTML = `<p class="booking-service-total">${transferLabel}: ${formatCurrency(transferAmount)}</p>${transferBreakdown}${transferDetailsMarkup(savedAppointment)}`;
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
  const bookingStaffId = $('#booking-staff').value;
  const transferNow = paymentMethod === 'transfer' && $('#transfer-timing').value === 'now';
  if (!$('#booking-staff').value) {
    setBookingStep('details');
    $('#booking-staff').reportValidity();
    return;
  }
  const selectedServices = selectedBookingServices();
  if (!selectedServices.length) {
    setBookingStep('details');
    showError($('#public-error'), 'Selecciona al menos un servicio antes de solicitar la cita.');
    $('#booking-services').querySelector('input')?.focus();
    return;
  }
  if (!name || !phone || !email) {
    setBookingStep('details');
    for (const selector of ['#customer-name', '#customer-phone', '#customer-email']) {
      if (!$(selector).reportValidity()) return;
    }
    return;
  }
  if (paymentMethod === 'transfer' && !$('#transfer-timing').value) {
    setBookingStep('details');
    $('#transfer-timing').reportValidity();
    return;
  }
  if (!selectedTime) {
    showError($('#public-error'), 'Elige una hora disponible para solicitar la cita.');
    $('#slots').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    const selectedStaff = publicStaffList.find((staff) => staff.id === bookingStaffId);
    const requiresTransferPayment = paymentMethod === 'transfer' || Boolean(selectedStaff?.deposit_enabled);
    if (requiresTransferPayment) {
      let emailNotice = '';
      if (transferNow) {
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
      }
      try {
        await showTransferDetails(appointment, emailNotice, bookingStaffId);
      } catch (detailsError) {
        showError($('#public-error'), detailsError.message);
      }
    }
  } catch (error) {
    showError($('#public-error'), error.message);
    selectedTime = null;
    await loadSlots();
  } finally {
    button.disabled = false;
    button.innerHTML = 'Solicitar cita <span>→</span>';
  }
}
function setDashboardSection(section) {
  if (!dashboardSections.includes(section)) return;
  activeDashboardSection = section;
  document.querySelectorAll('#dashboard [data-dashboard-section]').forEach((button) => {
    const selected = button.dataset.dashboardSection === section;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  $('#dashboard-more-menu').classList.add('hidden');
  $('[data-dashboard-more]').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('.dashboard-section').forEach((panel) => panel.classList.add('hidden'));
  $(`#dashboard-${section}`).classList.remove('hidden');
  if (section === 'schedule') loadScheduleEditor();
  if (section === 'income') loadIncomeSummary();
  if (section === 'calendar') loadCalendarWeek();
  closeTopbarMenu();
}
function statusName(status) {
  return ({ pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', cancelled: 'Cancelada', attended: 'Atendida', no_show: 'No llegó' })[status] || status;
}
function renderPersonalAppointment(appointment) {
  const preservedValues = {
    emailReminder: $('#appointment-reminder-email')?.checked,
    pushReminder: $('#appointment-reminder-push')?.checked,
    rating: $('#appointment-review-rating')?.value,
    review: $('#appointment-review-comment')?.value
  };
  const statusClass = appointment.status === 'pending' ? 'pending' : ['rejected', 'cancelled', 'no_show'].includes(appointment.status) ? 'rejected' : 'accepted';
  const expiry = appointment.status === 'pending' && appointment.expires_at ? `<p class="form-note">El barbero tiene hasta ${new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' }).format(new Date(appointment.expires_at))} para responder.</p>` : '';
  const delayNotice = appointment.status === 'accepted' && appointment.delay_minutes
    ? `<div class="delay-notice" role="status"><strong>Aviso del barbero</strong><span>Tu cita presenta un retraso aproximado de ${appointment.delay_minutes} minutos. Gracias por tu comprensión.</span></div>`
    : '';
  const requestedServices = appointmentServicesMarkup(
    appointment.requested_services,
    appointment.quoted_amount,
    appointment.amount_charged
  );
  const transferProofMessage = !appointment.transfer_proof_uploaded
    ? ''
    : appointment.transfer_verification_status === 'verified'
      ? 'El barbero confirmó el pago.'
      : appointment.transfer_verification_status === 'not_verified'
        ? 'El barbero no pudo verificar el comprobante. Revisa los datos y envía una nueva captura.'
        : 'Comprobante enviado. Espera la revisión del barbero.';
  const canUploadTransferProof = ['pending', 'accepted'].includes(appointment.status)
    && appointment.transfer_verification_status !== 'verified';
  const transferProof = appointment.transfer_payment_required
    ? `<section class="transfer-details-section">
        <h3>${appointment.deposit_amount_due < appointment.quoted_amount ? 'Anticipo por transferencia' : 'Pago total por transferencia'}</h3>
        <p class="form-note">${appointment.deposit_amount_due < appointment.quoted_amount
          ? `Anticipo solicitado: ${formatCurrency(appointment.deposit_amount_due)} de ${formatCurrency(appointment.quoted_amount)}. El saldo de ${formatCurrency(appointment.quoted_amount - appointment.deposit_amount_due)} se paga al finalizar el servicio.`
          : `Pago total solicitado: ${formatCurrency(appointment.deposit_amount_due || appointment.quoted_amount)}.`}${appointment.payment_method === 'cash' ? ` Aunque elegiste efectivo, el anticipo se paga por transferencia; el saldo de ${formatCurrency(Math.max(0, appointment.quoted_amount - appointment.deposit_amount_due))} se paga en efectivo al finalizar.` : ''}</p>
        ${transferDetailsMarkup(appointment)}
        ${transferProofMessage ? `<p class="transfer-proof-state">${transferProofMessage}</p>` : ''}
        ${canUploadTransferProof && (!appointment.transfer_proof_uploaded || appointment.transfer_verification_status === 'not_verified')
          ? `<form id="transfer-proof-form" class="transfer-proof-form">
                <label class="field-label" for="transfer-proof-file">Captura del comprobante (JPG, PNG o WebP; máximo 5 MB)</label>
                <input id="transfer-proof-file" type="file" accept="image/jpeg,image/png,image/webp" required>
                <button class="primary-button full-button" type="submit">Enviar comprobante</button>
              </form>`
          : !canUploadTransferProof && !appointment.transfer_proof_uploaded
            ? '<p class="form-note">Esta cita ya no admite comprobantes de pago.</p>'
            : ''}
      </section>`
    : '';
  $('#appointment-details').innerHTML = `
    <span class="status-pill ${statusClass}">${statusName(appointment.status)}</span>
    ${delayNotice}
    <div class="detail-grid">
      <div class="detail-item"><span>DÍA</span><strong>${appointment.appointment_date}</strong></div>
      <div class="detail-item"><span>HORA · COLOMBIA</span><strong>${formatTime(appointment.appointment_time)}</strong></div>
      <div class="detail-item"><span>NOMBRE</span><strong>${escapeHtml(appointment.customer_name)}</strong></div>
      <div class="detail-item"><span>MÉTODO DE PAGO</span><strong>${appointment.transfer_payment_required
        ? appointment.deposit_amount_due < appointment.quoted_amount ? 'Anticipo por transferencia' : 'Pago total por transferencia'
        : 'Efectivo'}</strong></div>
    </div>
    ${requestedServices}
    ${transferProof}
    ${appointment.transfer_payment_required && appointment.transfer_proof_uploaded && ['pending', 'accepted'].includes(appointment.status)
      ? `<div class="transfer-verification-status ${appointment.transfer_verification_status || 'pending'}" role="status"><strong>${transferVerificationLabel(appointment.transfer_verification_status)}</strong><span>${appointment.deposit_amount_due < appointment.quoted_amount ? 'Anticipo' : 'Pago total'} de ${formatCurrency(appointment.deposit_amount_due || appointment.quoted_amount)}: ${transferVerificationMessage(appointment.transfer_verification_status)}</span></div>`
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
  $('#transfer-proof-form')?.addEventListener('submit', submitTransferProof);
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
async function submitTransferProof(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fileInput = $('#transfer-proof-file');
  const file = fileInput.files?.[0];
  const button = form.querySelector('button[type="submit"]');
  const allowedTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!file || !allowedTypes[file.type]) {
    showError($('#appointment-error'), 'Selecciona una captura en formato JPG, PNG o WebP.');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showError($('#appointment-error'), 'La captura debe pesar máximo 5 MB.');
    return;
  }
  button.disabled = true;
  $('#appointment-error').classList.add('hidden');
  try {
    requireConnection();
    const appointment = await db.rpc('public_appointment_by_token', { token: appointmentToken });
    if (appointment.error) throw appointment.error;
    const details = Array.isArray(appointment.data) ? appointment.data[0] : appointment.data;
    if (!details?.id) throw new Error('No pudimos identificar la cita para asociar el comprobante.');
    if (!details.transfer_proof_upload_token) {
      throw new Error('No pudimos preparar el comprobante para esta cita. Recarga el enlace e inténtalo de nuevo.');
    }
    const path = `${details.id}/${details.transfer_proof_upload_token}/proof.${allowedTypes[file.type]}`;
    const { error: uploadError } = await db.storage.from('appointment-payment-proofs').upload(path, file, {
      contentType: file.type,
      upsert: true
    });
    if (uploadError) throw uploadError;
    const { data, error } = await db.rpc('submit_appointment_transfer_proof', {
      p_token: appointmentToken,
      p_file_path: path
    });
    if (error) throw error;
    if (data !== true) throw new Error('Supabase no confirmó el comprobante. Intenta de nuevo.');
    await loadPersonalAppointment();
    toast('Comprobante enviado al barbero para revisión.');
  } catch (error) {
    showError($('#appointment-error'), error.message);
    button.disabled = false;
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
function configureScheduleDateRange() {
  const limits = bookingWeekLimit();
  const input = $('#schedule-date');
  input.min = limits.today;
  input.max = limits.maxDate;
  if (!input.value || input.value < limits.today || input.value > limits.maxDate) input.value = limits.today;
}
function configureAdminWeekRange() {
  const limits = bookingWeekLimit();
  const input = $('#admin-date');
  input.min = limits.today;
  input.max = limits.maxDate;
  if (!input.value || input.value < limits.today || input.value > limits.maxDate) input.value = limits.today;
}
async function loadScheduleEditor() {
  if (!adminBarberProfile) return;
  const requestId = ++scheduleLoadRequest;
  configureScheduleDateRange();
  const date = $('#schedule-date').value;
  $('#schedule-error').classList.add('hidden');
  $('#schedule-working-label').textContent = `Disponible el ${formatBookingDate(date)}`;
  $('#clear-date-schedule').classList.add('hidden');
  try {
    const { data, error } = await db.from('work_hour_overrides').select('is_working, opens_at, closes_at')
      .eq('barber_id', adminBarberProfile.id).eq('staff_id', adminStaffId).eq('work_date', date).maybeSingle();
    if (error) throw error;
    if (requestId !== scheduleLoadRequest) return;
    if (data) {
      setScheduleControls(data.is_working, data.opens_at, data.closes_at);
      $('#clear-date-schedule').classList.remove('hidden');
    } else {
      setScheduleControls(false, '09:00:00', '18:00:00');
    }
  } catch (error) {
    if (requestId !== scheduleLoadRequest) return;
    showError($('#schedule-error'), error.message);
  }
}
async function saveSchedule() {
  if (!adminBarberProfile) return;
  configureScheduleDateRange();
  const date = $('#schedule-date').value;
  const working = $('#schedule-working').checked;
  const opensAt = getTwelveHourPickerValue($('#schedule-open-time'));
  const closesAt = getTwelveHourPickerValue($('#schedule-close-time'));
  const limits = bookingWeekLimit();
  if (!date || date < limits.today || date > limits.maxDate) {
    showError($('#schedule-error'), 'Solo puedes organizar los días restantes de esta semana. La semana siguiente se habilita el domingo.');
    return;
  }
  if (opensAt >= closesAt) {
    showError($('#schedule-error'), 'La hora de cierre debe ser posterior a la hora de apertura.');
    return;
  }
  const button = $('#save-schedule');
  const originalButtonText = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Guardando horario…';
  $('#schedule-error').classList.add('hidden');
  try {
    const row = { barber_id: adminBarberProfile.id, staff_id: adminStaffId, work_date: date, is_working: working, opens_at: opensAt, closes_at: closesAt };
    const { data, error } = await db.from('work_hour_overrides').upsert(row, { onConflict: 'barber_id,staff_id,work_date' }).select();
    if (error) throw error;
    if (data?.length !== 1) throw new Error('Supabase no confirmó el horario de este día. Revisa los permisos del barbero y vuelve a intentar.');
    await loadScheduleEditor();
    await loadAdminAppointments();
    toast('Horario de este día guardado.');
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
  toast('Se quitó la configuración de este día; no se ofrecerán horarios.');
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
  }
  const values = {
    transfer_methods: methods,
    service_catalog: services,
    deposit_enabled: $('#deposit-enabled').checked,
    deposit_type: $('#deposit-type').value
  };
  button.disabled = true;
  button.textContent = 'Guardando…';
  try {
    for (const service of serviceCatalogState) {
      services.push({ id: service.id, name: service.name.trim(), price: Number(service.price) });
    }
    values.service_catalog = services;
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
    serviceCatalogState = services.map((service) => ({
      id: service.id,
      name: service.name,
      price: String(service.price)
    }));
    renderServiceCatalogEditors();
    toast('Servicios, precios y medios de pago guardados para este barbero.');
  } catch (error) {
    showError(errorElement, error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Guardar cambios <span>→</span>';
  }
}
function loadServiceCatalogSettings(profile) {
  const services = Array.isArray(profile.service_catalog) ? profile.service_catalog : [];
  serviceCatalogState = services.map((service) => ({
    id: service.id || createUuid(),
    name: service.name || '',
    price: String(service.price ?? '')
  }));
  renderServiceCatalogEditors();
}
function loadPublicGallerySettings(profile) {
  publicGalleryState.forEach((image) => {
    if (image.preview_url) URL.revokeObjectURL(image.preview_url);
  });
  publicGalleryState = (Array.isArray(profile.public_gallery) ? profile.public_gallery : [])
    .filter((path) => isProfileGalleryPath(path, adminBarberProfile.id, adminStaffId))
    .map((path) => ({ path, preview_url: '', file: null }));
  renderPublicGalleryEditor();
}
function renderPublicGalleryEditor() {
  const container = $('#public-gallery-list');
  container.replaceChildren();
  if (!publicGalleryState.length) {
    const empty = document.createElement('p');
    empty.className = 'form-note';
    empty.textContent = 'Todavía no hay fotos en la galería pública.';
    container.append(empty);
  }
  publicGalleryState.forEach((image, index) => {
    const url = image.preview_url || (image.path
      ? db.storage.from('barber-profile-gallery').getPublicUrl(image.path).data.publicUrl
      : '');
    const card = document.createElement('article');
    card.className = 'public-gallery-item';
    const preview = document.createElement('img');
    preview.src = url;
    preview.alt = `Foto de la galería ${index + 1}`;
    preview.loading = 'lazy';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'break-remove';
    removeButton.textContent = 'Quitar';
    removeButton.setAttribute('aria-label', `Quitar foto ${index + 1}`);
    removeButton.addEventListener('click', () => {
      if (image.preview_url) URL.revokeObjectURL(image.preview_url);
      publicGalleryState.splice(index, 1);
      renderPublicGalleryEditor();
    });
    card.append(preview, removeButton);
    container.append(card);
  });
  const addInput = $('#public-gallery-files');
  addInput.disabled = publicGalleryState.length >= 12;
  addInput.setAttribute('aria-describedby', 'public-gallery-count public-gallery-help');
  $('#public-gallery-count').textContent = `${publicGalleryState.length} de 12 fotos`;
}
function addPublicGalleryFiles(event) {
  const input = event.currentTarget;
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const invalidFile = files.find((file) => !allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024);
  if (invalidFile) {
    $('#public-gallery-status').textContent = '';
    showError($('#public-gallery-error'), 'Cada foto debe ser JPG, PNG o WebP y pesar máximo 5 MB.');
    return;
  }
  if (publicGalleryState.length + files.length > 12) {
    $('#public-gallery-status').textContent = '';
    showError($('#public-gallery-error'), `Puedes publicar hasta 12 fotos. Te quedan ${12 - publicGalleryState.length} espacios.`);
    return;
  }
  $('#public-gallery-error').classList.add('hidden');
  files.forEach((file) => {
    publicGalleryState.push({ path: '', file, preview_url: URL.createObjectURL(file) });
  });
  renderPublicGalleryEditor();
  $('#public-gallery-status').textContent = `${files.length} ${files.length === 1 ? 'foto lista' : 'fotos listas'}. Pulsa «Guardar galería» para publicarlas.`;
}
async function savePublicGallery() {
  const button = $('#save-public-gallery');
  const errorElement = $('#public-gallery-error');
  const statusElement = $('#public-gallery-status');
  errorElement.classList.add('hidden');
  statusElement.textContent = '';
  if (!adminBarberProfile || !adminStaffId) {
    showError(errorElement, 'No se pudo identificar al barbero que administra esta galería. Recarga el panel e inténtalo de nuevo.');
    return;
  }
  if (!db) {
    showError(errorElement, 'No hay conexión con Supabase. Recarga la página e inténtalo de nuevo.');
    return;
  }
  if (publicGalleryState.length > 12) {
    showError(errorElement, 'Puedes publicar hasta 12 fotos por profesional.');
    return;
  }
  const galleryCount = publicGalleryState.length;
  const uploadedPaths = [];
  button.disabled = true;
  button.textContent = 'Subiendo fotos…';
  statusElement.textContent = 'Guardando la galería. No cierres esta página.';
  try {
    const oldPaths = (Array.isArray(adminStaffConfig?.public_gallery) ? adminStaffConfig.public_gallery : [])
      .filter((path) => isProfileGalleryPath(path, adminBarberProfile.id, adminStaffId));
    const galleryBucket = db.storage.from('barber-profile-gallery');
    const paths = [];
    for (const image of publicGalleryState) {
      if (!image.file) {
        paths.push(image.path);
        continue;
      }
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.file.type];
      const path = `${adminBarberProfile.id}/${adminStaffId}/gallery/${createUuid()}.${extension}`;
      const { error: uploadError } = await galleryBucket.upload(path, image.file, {
        cacheControl: '31536000',
        contentType: image.file.type,
        upsert: false
      });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
      paths.push(path);
    }
    const { data, error } = await db.from('barber_team_members')
      .update({ public_gallery: paths })
      .eq('id', adminStaffId)
      .eq('barber_id', adminBarberProfile.id)
      .select('id, public_gallery')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Supabase no confirmó el guardado de la galería. Verifica los permisos del profesional.');
    Object.assign(adminStaffConfig, { public_gallery: data.public_gallery });
    const member = teamMembers.find((item) => item.id === adminStaffId);
    if (member) member.public_gallery = data.public_gallery;
    publicGalleryState.forEach((image) => {
      if (image.preview_url) URL.revokeObjectURL(image.preview_url);
    });
    publicGalleryState = paths.map((path) => ({ path, file: null, preview_url: '' }));
    renderPublicGalleryEditor();
    const removedPaths = oldPaths.filter((path) => !paths.includes(path));
    if (removedPaths.length) {
      const { error: removeError } = await galleryBucket.remove(removedPaths);
      if (removeError) {
        console.error('No se pudieron limpiar algunas fotos quitadas de la galería:', removeError);
        showError(errorElement, `La galería sí se guardó, pero algunas fotos quitadas siguen en el almacenamiento. Detalle: ${removeError.message}`);
        statusElement.textContent = 'La galería se guardó, pero no se pudieron eliminar algunas fotos antiguas.';
        return;
      }
    }
    statusElement.textContent = `Galería guardada correctamente: ${galleryCount} ${galleryCount === 1 ? 'foto publicada' : 'fotos publicadas'}.`;
    toast('Galería pública guardada.');
  } catch (error) {
    const failureMessage = error?.message || 'Ocurrió un error inesperado al guardar la galería.';
    if (uploadedPaths.length) {
      try {
        const { error: cleanupError } = await db.storage.from('barber-profile-gallery').remove(uploadedPaths);
        if (cleanupError) {
          console.error('No se pudieron limpiar fotos subidas para una galería que no se guardó:', cleanupError);
          showError(errorElement, `${failureMessage} Además, no se pudieron limpiar algunas fotos nuevas. Detalle: ${cleanupError.message}`);
          statusElement.textContent = 'No se pudo guardar la galería. Revisa el mensaje de error.';
          return;
        }
      } catch (cleanupError) {
        console.error('No se pudieron limpiar fotos subidas para una galería que no se guardó:', cleanupError);
        showError(errorElement, `${failureMessage} Además, ocurrió un error al limpiar las fotos nuevas: ${cleanupError.message || 'error inesperado'}`);
        statusElement.textContent = 'No se pudo guardar la galería. Revisa el mensaje de error.';
        return;
      }
    }
    showError(errorElement, failureMessage);
    statusElement.textContent = 'No se pudo guardar la galería. Revisa el mensaje de error.';
  } finally {
    button.disabled = false;
    button.innerHTML = 'Guardar galería <span>→</span>';
  }
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
  serviceCatalogState.push({ id: createUuid(), name: '', price: '' });
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
  $('#deposit-enabled').checked = Boolean(profile.deposit_enabled);
  $('#deposit-type').value = profile.deposit_type === 'fixed' ? 'fixed' : 'percent';
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
  const limits = bookingWeekLimit();
  if (date < limits.today || date > limits.maxDate) {
    showError($('#break-error'), 'Solo puedes organizar descansos de esta semana. La semana siguiente se habilita el domingo.');
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
    .select('id, display_name, email, auth_user_id, is_active, is_primary, service_catalog, transfer_methods, public_gallery, slot_minutes, deposit_enabled, deposit_type')
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
  configureScheduleDateRange();
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
  loadPublicGallerySettings(adminStaffConfig);
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
  let platformAdminPanelActive = false;
  try {
    $('#admin-error').classList.add('hidden');
    $('#platform-admin-error').classList.add('hidden');
    const { data: platformAdmin, error: platformAdminError } = await db.rpc('is_platform_admin');
    if (platformAdminError) throw platformAdminError;
    isPlatformAdmin = Boolean(platformAdmin);
    const openPlatformAdminPanel = async () => {
      platformAdminPanelActive = true;
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
    };
    if (platformAdminRequested) {
      await openPlatformAdminPanel();
      return;
    }
    $('#platform-admin-panel').classList.add('hidden');
    const { data: barberId, error: barberIdError } = await db.rpc('current_barber_id');
    if (barberIdError) throw barberIdError;
    if (!barberId && isPlatformAdmin) {
      await openPlatformAdminPanel();
      return;
    }
    if (!barberId) {
      throw new Error('Esta cuenta no está asociada a ninguna barbería. Contacta al administrador para que la vincule al equipo correcto.');
    }
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
      if ($('#transfer-proof-dialog')?.open) return;
      loadAdminAppointments();
    }, 5000);
  } catch (error) {
    showError(platformAdminPanelActive ? $('#platform-admin-error') : $('#admin-error'), error.message);
  }
}
async function loadAdminAppointments() {
  const requestId = ++adminAppointmentsLoadRequest;
  const date = $('#admin-date').value;
  if (!date || !db || !adminBarberProfile) return false;
  const weekStart = getWeekStart(date);
  const weekEnd = shiftDate(weekStart, 7);
  $('#admin-week-label').textContent = `${formatBookingDate(weekStart)} – ${formatBookingDate(shiftDate(weekEnd, -1))}`;
  try {
    const { error: expiryError } = await db.rpc('expire_barber_pending_appointments');
    if (expiryError) throw expiryError;
    const today = dateInBogota();
      const noShowStart = weekStart;
      const noShowEnd = weekEnd;
    const [pendingResult, appointmentsResult, debtsResult, noShowResult, todayAppointmentsResult] = await Promise.all([
      db.from('appointments')
        .select('id, staff_id, customer_name, customer_phone, customer_email, appointment_date, appointment_time, payment_method, transfer_payment_required, transfer_now, transfer_proof_path, transfer_verification_status, deposit_amount_due, status, expires_at, created_at, requested_services, quoted_amount')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .eq('status', 'pending')
        .gte('appointment_date', weekStart)
        .lt('appointment_date', weekEnd)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true }),
      db.from('appointments')
        .select('id, staff_id, customer_name, customer_phone, customer_email, appointment_date, appointment_time, payment_method, transfer_payment_required, transfer_proof_path, transfer_verification_status, deposit_amount_due, status, expires_at, delay_minutes, payment_status, debt_amount, created_at, requested_services, quoted_amount')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .eq('status', 'accepted')
        .gte('appointment_date', weekStart)
        .lt('appointment_date', weekEnd)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true }),
      db.from('appointments')
        .select('id, staff_id, customer_name, customer_phone, appointment_date, appointment_time, payment_method, payment_status, debt_amount, completed_at')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .eq('status', 'attended')
        .eq('payment_status', 'debt')
        .order('appointment_date', { ascending: false })
        .order('appointment_time', { ascending: false }),
      db.from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .eq('status', 'no_show')
        .gte('appointment_date', noShowStart)
        .lt('appointment_date', noShowEnd),
      db.from('appointments')
        .select('id, customer_name, appointment_date, appointment_time, status, payment_status, payment_method, requested_services')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .eq('appointment_date', today)
        .in('status', ['pending', 'accepted', 'attended', 'no_show'])
        .order('appointment_time', { ascending: true })
    ]);
    if (requestId !== adminAppointmentsLoadRequest) return false;
    if (pendingResult.error) throw pendingResult.error;
    if (appointmentsResult.error) throw appointmentsResult.error;
    if (debtsResult.error) throw debtsResult.error;
    if (noShowResult.error) throw noShowResult.error;
    if (todayAppointmentsResult.error) throw todayAppointmentsResult.error;
    const pendingAppointments = pendingResult.data || [];
    const acceptedAppointments = appointmentsResult.data || [];
    const appointmentsWithProof = [...pendingAppointments, ...acceptedAppointments].filter((appointment) => appointment.transfer_proof_path);
    await Promise.all(appointmentsWithProof.map(async (appointment) => {
      const { data, error } = await db.storage.from('appointment-payment-proofs')
        .createSignedUrl(appointment.transfer_proof_path, 900);
      if (error) throw error;
      appointment.transfer_proof_url = data.signedUrl;
    }));
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
    renderTodayOverview(pendingAppointments, acceptedAppointments, todayAppointmentsResult.data || []);
    $('#no-show-summary').textContent = `Esta semana: ${noShowResult.count || 0} ${noShowResult.count === 1 ? 'cita en la que el cliente no llegó' : 'citas en las que los clientes no llegaron'}.`;
    $('#admin-error').classList.add('hidden');
    return true;
  } catch (error) {
    if (requestId === adminAppointmentsLoadRequest) showError($('#admin-error'), error.message);
    return false;
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
  const limits = bookingWeekLimit();
  const currentWeekStart = limits.currentWeekStart;
  const maxWeekStart = limits.nextWeekAllowed ? shiftDate(currentWeekStart, 7) : currentWeekStart;
  if (calendarWeekStart < currentWeekStart) calendarWeekStart = currentWeekStart;
  if (calendarWeekStart > maxWeekStart) calendarWeekStart = maxWeekStart;
  const weekStart = calendarWeekStart;
  const weekEnd = shiftDate(weekStart, 7);
  errorElement.classList.add('hidden');
  container.setAttribute('aria-busy', 'true');
  $('#calendar-week-label').textContent = `${formatBookingDate(weekStart)} al ${formatBookingDate(shiftDate(weekEnd, -1))}`;
  $('#calendar-prev-week').disabled = weekStart <= currentWeekStart;
  $('#calendar-next-week').disabled = shiftDate(weekStart, 7) > maxWeekStart;
  try {
    const weekStartTimestamp = `${weekStart}T00:00:00-05:00`;
    const weekEndTimestamp = `${weekEnd}T00:00:00-05:00`;
    const [appointmentsResult, overridesResult, blockedResult] = await Promise.all([
      db.from('appointments')
        .select('id, customer_name, customer_phone, appointment_date, appointment_time, status, payment_method, transfer_payment_required, deposit_amount_due, requested_services, quoted_amount')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .in('status', ['pending', 'accepted'])
        .gte('appointment_date', weekStart)
        .lt('appointment_date', weekEnd)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true }),
      db.from('work_hour_overrides')
        .select('work_date, is_working, opens_at, closes_at')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .gte('work_date', weekStart)
        .lt('work_date', weekEnd),
      db.from('blocked_slots')
        .select('id, starts_at, ends_at, reason')
        .eq('barber_id', adminBarberProfile.id)
        .eq('staff_id', adminStaffId)
        .lt('starts_at', weekEndTimestamp)
        .gt('ends_at', weekStartTimestamp)
    ]);
    for (const result of [appointmentsResult, overridesResult, blockedResult]) {
      if (result.error) throw result.error;
    }
    if (requestId !== calendarLoadRequest) return;
    const appointmentsByDate = new Map();
    for (const appointment of appointmentsResult.data || []) {
      if (!appointmentsByDate.has(appointment.appointment_date)) appointmentsByDate.set(appointment.appointment_date, []);
      appointmentsByDate.get(appointment.appointment_date).push(appointment);
    }
    const overridesByDate = new Map((overridesResult.data || []).map((override) => [override.work_date, override]));
    const blockedSlots = blockedResult.data || [];
    const slotDuration = Number(adminStaffConfig?.slot_minutes || teamMembers.find((member) => member.id === adminStaffId)?.slot_minutes || 30);
    const weekContent = document.createDocumentFragment();
    for (let offset = 0; offset < 7; offset += 1) {
      const date = shiftDate(weekStart, offset);
      const day = document.createElement('section');
      day.className = 'calendar-day';
      day.dataset.date = date;
      const heading = document.createElement('h3');
      heading.textContent = formatBookingDate(date);
      day.append(heading);
      const appointments = appointmentsByDate.get(date) || [];
      if (appointments.length) {
        for (const appointment of appointments) {
          const item = document.createElement('article');
          item.className = 'calendar-appointment';
          const title = document.createElement('strong');
          title.textContent = `${formatTime(appointment.appointment_time)} · ${appointment.customer_name}`;
          const meta = document.createElement('span');
          meta.textContent = `${statusName(appointment.status)} · ${appointment.transfer_payment_required
            ? appointment.deposit_amount_due < appointment.quoted_amount ? 'Anticipo por transferencia' : 'Pago total por transferencia'
            : 'Efectivo'}`;
          item.append(title, meta);
          const serviceText = (appointment.requested_services || []).map((service) => service.name).filter(Boolean).join(', ');
          if (serviceText) {
            const services = document.createElement('span');
            services.textContent = serviceText;
            item.append(services);
          }
          day.append(item);
        }
      } else {
        const empty = document.createElement('p');
        empty.className = 'form-note';
        empty.textContent = 'Sin citas pendientes ni aceptadas.';
        day.append(empty);
      }
      const hours = overridesByDate.get(date);
      if (hours?.is_working && slotDuration > 0) {
        const openingMinutes = timeToMinutes(hours.opens_at);
        const closingMinutes = timeToMinutes(hours.closes_at);
        const dayAppointments = appointments.map((appointment) => {
          const start = timeToMinutes(appointment.appointment_time);
          return { start, end: start + slotDuration };
        });
        const dayStartTimestamp = new Date(`${date}T00:00:00-05:00`).getTime();
        const dayEndTimestamp = new Date(`${shiftDate(date, 1)}T00:00:00-05:00`).getTime();
        const dayBlockedSlots = blockedSlots.filter((slot) => {
          const startsAt = new Date(slot.starts_at).getTime();
          const endsAt = new Date(slot.ends_at).getTime();
          return startsAt < dayEndTimestamp && endsAt > dayStartTimestamp;
        });
        const freeSlots = [];
        for (let minute = openingMinutes; minute + slotDuration <= closingMinutes; minute += slotDuration) {
          const time = minutesToTime(minute);
          const slotStartTimestamp = new Date(`${date}T${time}-05:00`).getTime();
          const slotEndTimestamp = slotStartTimestamp + slotDuration * 60000;
          const occupied = dayAppointments.some((appointment) => minute < appointment.end && minute + slotDuration > appointment.start);
          const blocked = dayBlockedSlots.some((slot) => new Date(slot.starts_at).getTime() < slotEndTimestamp && new Date(slot.ends_at).getTime() > slotStartTimestamp);
          if (slotStartTimestamp > Date.now() && !occupied && !blocked) freeSlots.push({ date, time });
        }
        const calendarBlocks = dayBlockedSlots.filter((slot) => slot.reason === 'Bloqueado desde agenda' && new Date(slot.ends_at).getTime() > Date.now());
        if (calendarBlocks.length) {
          const blockedSection = document.createElement('div');
          blockedSection.className = 'calendar-free-slots calendar-blocked-slots';
          const blockedHeading = document.createElement('p');
          blockedHeading.textContent = 'Horarios bloqueados desde agenda';
          blockedSection.append(blockedHeading);
          const blockedList = document.createElement('div');
          blockedList.className = 'calendar-free-slot-list';
          calendarBlocks.forEach((slot) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'calendar-free-slot calendar-unblock-slot';
            button.dataset.id = slot.id;
            const startTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(slot.starts_at));
            button.dataset.time = startTime;
            button.textContent = `Reactivar ${formatTime(startTime)}`;
            button.setAttribute('aria-label', `Volver a ofrecer el horario bloqueado de ${formatTime(startTime)} el ${formatBookingDate(date)}`);
            button.addEventListener('click', unblockCalendarSlot);
            blockedList.append(button);
          });
          blockedSection.append(blockedList);
          day.append(blockedSection);
        }
        if (freeSlots.length) {
          const freeSection = document.createElement('div');
          freeSection.className = 'calendar-free-slots';
          const freeHeading = document.createElement('p');
          freeHeading.textContent = 'Libre · toca para bloquear';
          freeSection.append(freeHeading);
          const freeList = document.createElement('div');
          freeList.className = 'calendar-free-slot-list';
          freeSlots.forEach((slot) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'calendar-free-slot';
            button.dataset.date = slot.date;
            button.dataset.time = slot.time;
            button.textContent = formatTime(slot.time);
            button.setAttribute('aria-label', `Bloquear horario libre ${formatTime(slot.time)} el ${formatBookingDate(slot.date)}`);
            button.addEventListener('click', blockCalendarSlot);
            freeList.append(button);
          });
          freeSection.append(freeList);
          day.append(freeSection);
        }
      }
      weekContent.append(day);
    }
    container.replaceChildren(weekContent);
  } catch (error) {
    if (requestId === calendarLoadRequest) showError(errorElement, error.message);
  } finally {
    if (requestId === calendarLoadRequest) container.removeAttribute('aria-busy');
  }
}
function timeToMinutes(value) {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
}
function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}:00`;
}
async function blockCalendarSlot(event) {
  const button = event.currentTarget;
  const slotDate = button.dataset.date;
  const slotTime = button.dataset.time;
  const confirmation = `¿Bloquear el horario de ${formatTime(slotTime)} del ${formatBookingDate(slotDate)}?`;
  if (!slotDate || !slotTime || !window.confirm(confirmation)) return;
  button.disabled = true;
  $('#calendar-error').classList.add('hidden');
  try {
    const { data, error } = await db.rpc('block_barber_calendar_slot', {
      p_staff_id: adminStaffId,
      p_date: slotDate,
      p_time: slotTime
    });
    if (error) throw error;
    if (data !== true) throw new Error('Supabase no confirmó el bloqueo del horario.');
    await Promise.all([loadCalendarWeek(), loadAdminAppointments()]);
    toast(`Horario de ${formatTime(slotTime)} bloqueado.`);
  } catch (error) {
    showError($('#calendar-error'), error.message);
    button.disabled = false;
  }
}
async function unblockCalendarSlot(event) {
  const button = event.currentTarget;
  const blockId = button.dataset.id;
  const date = button.closest('.calendar-day')?.dataset.date;
  const time = button.dataset.time;
  if (!blockId || !date || !time) {
    showError($('#calendar-error'), 'No se pudo identificar el horario bloqueado. Actualiza la semana e inténtalo de nuevo.');
    return;
  }
  if (!window.confirm(`¿Volver a ofrecer el horario de ${formatTime(time)} del ${formatBookingDate(date)}?`)) return;
  button.disabled = true;
  $('#calendar-error').classList.add('hidden');
  try {
    const { data, error } = await db.from('blocked_slots')
      .delete()
      .eq('id', blockId)
      .eq('barber_id', adminBarberProfile.id)
      .eq('staff_id', adminStaffId)
      .eq('reason', 'Bloqueado desde agenda')
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se quitó el bloqueo. Actualiza la semana e inténtalo de nuevo.');
    await Promise.all([loadCalendarWeek(), loadAdminAppointments()]);
    toast(`Horario de ${formatTime(time)} disponible nuevamente.`);
  } catch (error) {
    showError($('#calendar-error'), error.message);
    button.disabled = false;
  }
}
function renderAdminAppointments(pendingAppointments, acceptedAppointments, debts) {
  const activeAppointmentIds = new Set(acceptedAppointments.map((appointment) => appointment.id));
  for (const appointmentId of finishFormStates.keys()) {
    if (!activeAppointmentIds.has(appointmentId)) finishFormStates.delete(appointmentId);
  }
  $('#pending-count').textContent = pendingAppointments.length;
  $('#accepted-count').textContent = acceptedAppointments.length;
  document.querySelectorAll('[data-dashboard-count="requests"]').forEach((badge) => {
    badge.textContent = String(pendingAppointments.length);
  });
  document.querySelectorAll('[data-dashboard-count="accepted"]').forEach((badge) => {
    badge.textContent = String(acceptedAppointments.length);
  });
  renderAppointmentCards($('#appointment-list'), pendingAppointments, 'No tienes solicitudes pendientes.');
  renderAppointmentCards($('#accepted-appointment-list'), acceptedAppointments, 'Todavía no tienes citas aceptadas.', { canFinalize: true });
  renderDebtCards(debts);
  setDashboardStatsLoading(false);
}
function setDashboardStatsLoading(isLoading) {
  const stats = $('#dashboard-global-stats');
  const status = $('#dashboard-stats-status');
  const countElements = stats.querySelectorAll('#pending-count, #accepted-count, [data-dashboard-count]');
  stats.setAttribute('aria-busy', String(isLoading));
  status.classList.toggle('hidden', !isLoading);
  status.textContent = isLoading ? 'Actualizando agenda…' : '';
  countElements.forEach((element) => {
    if (isLoading) {
      element.dataset.previousValue = element.textContent;
      element.textContent = '…';
    } else {
      if (element.textContent === '…' && element.dataset.previousValue !== undefined) {
        element.textContent = element.dataset.previousValue;
      }
      delete element.dataset.previousValue;
    }
  });
}
function appointmentStartTime(appointment) {
  return new Date(`${appointment.appointment_date}T${appointment.appointment_time.slice(0, 8)}-05:00`).getTime();
}
function formatTimeUntilAppointment(timestamp) {
  const totalMinutes = Math.max(0, Math.ceil((timestamp - Date.now()) / 60000));
  if (totalMinutes < 60) return `En ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `En ${hours} h ${minutes} min` : `En ${hours} h`;
}
function renderTodayOverview(pendingAppointments, acceptedAppointments, dailyAppointments) {
  $('#today-date-label').textContent = formatBookingDate(dateInBogota());
  const now = Date.now();
  const nextAppointment = acceptedAppointments.find((appointment) => appointmentStartTime(appointment) >= now);
  const nextCard = $('#today-next-appointment');
  if (!nextAppointment) {
    nextCard.innerHTML = '<strong class="today-next-empty">No tienes próximas citas aceptadas.</strong><p>Las nuevas solicitudes aparecerán en tu agenda cuando un cliente reserve.</p>';
  } else {
    const appointmentStart = appointmentStartTime(nextAppointment);
    const serviceNames = (nextAppointment.requested_services || []).map((service) => service.name).filter(Boolean).join(', ');
    const dateLabel = nextAppointment.appointment_date === dateInBogota()
      ? formatTimeUntilAppointment(appointmentStart)
      : formatBookingDate(nextAppointment.appointment_date);
    nextCard.innerHTML = `
      <div class="today-next-topline"><span>PRÓXIMA CITA</span><strong>${escapeHtml(dateLabel)}</strong></div>
      <div class="today-next-time">${escapeHtml(formatTime(nextAppointment.appointment_time))}</div>
      <strong class="today-next-name">${escapeHtml(nextAppointment.customer_name)}</strong>
      <p>${escapeHtml(serviceNames || 'Servicio sin especificar')}</p>
      <button class="quiet-button full-button" type="button" data-dashboard-section="accepted">Ver citas aceptadas</button>`;
  }
  const dailyList = $('#today-appointment-list');
  if (!dailyAppointments.length) {
    dailyList.innerHTML = '<div class="empty-list">No tienes citas ni solicitudes para hoy.</div>';
  } else {
    dailyList.innerHTML = dailyAppointments.map((appointment) => {
      const stateClass = appointment.status;
      const services = (appointment.requested_services || []).map((service) => service.name).filter(Boolean).join(', ');
      const paymentStatus = appointment.status === 'attended'
        ? appointment.payment_status === 'paid' ? ' · Pagada' : appointment.payment_status === 'debt' ? ' · Debe' : ''
        : '';
      return `<article class="today-appointment ${stateClass}">
        <time>${escapeHtml(formatTime(appointment.appointment_time))}</time>
        <div><strong>${escapeHtml(appointment.customer_name)}</strong><span>${escapeHtml(services || 'Servicio sin especificar')}${paymentStatus}</span></div>
        <span class="status-pill ${stateClass}">${escapeHtml(statusName(appointment.status))}</span>
      </article>`;
    }).join('');
  }
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
    card.dataset.transferPaymentRequired = String(Boolean(appointment.transfer_payment_required));
    card.dataset.transferVerificationStatus = appointment.transfer_verification_status || 'not_required';
    card.dataset.transferProofPath = appointment.transfer_proof_path || '';
    card.dataset.transferProofUrl = appointment.transfer_proof_url || '';
    card.dataset.depositAmountDue = String(appointment.deposit_amount_due || 0);
    card.dataset.delayMinutes = String(appointment.delay_minutes || 0);
    card.dataset.quotedAmount = String(appointment.quoted_amount || 0);
    card.dataset.requestedServices = JSON.stringify(appointment.requested_services || []);
    const actions = appointment.status === 'pending'
      ? `<div class="appointment-actions"><button class="accept-button" data-action="accept" data-id="${appointment.id}" ${appointment.transfer_payment_required && !appointment.transfer_proof_path ? 'disabled title="El cliente debe enviar el comprobante primero."' : ''}>Aceptar</button><button class="reject-button" data-action="reject" data-id="${appointment.id}">Rechazar</button></div>`
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
    const transferNotice = appointment.status === 'pending' && appointment.transfer_payment_required
      ? `<div class="transfer-pending-notice" role="status"><strong>${appointment.transfer_proof_path ? (appointment.deposit_amount_due < appointment.quoted_amount ? 'Anticipo: comprobante recibido' : 'Pago total: comprobante recibido') : (appointment.deposit_amount_due < appointment.quoted_amount ? 'Falta el comprobante del anticipo' : 'Falta el comprobante del pago total')}</strong><span>${appointment.deposit_amount_due < appointment.quoted_amount
        ? `${appointment.transfer_proof_path ? 'Anticipo reportado' : 'Anticipo solicitado'}: ${formatCurrency(appointment.deposit_amount_due)} de ${formatCurrency(appointment.quoted_amount)}. ${appointment.transfer_proof_path ? 'Revisa la captura antes de aceptar.' : 'El cliente debe transferir este valor y subir la captura desde su enlace personal antes de aceptar la cita.'}`
        : `${appointment.transfer_proof_path ? 'Pago total reportado' : 'Pago total solicitado'}: ${formatCurrency(appointment.deposit_amount_due || appointment.quoted_amount)}. ${appointment.transfer_proof_path ? 'Revisa la captura antes de aceptar.' : 'El cliente debe transferir este valor y subir la captura desde su enlace personal antes de aceptar la cita.'}`}</span></div>`
      : '';
    const proofPreview = appointment.transfer_proof_url
      ? `<button class="transfer-proof-preview" type="button" data-view-transfer-proof="${escapeHtml(appointment.transfer_proof_url)}" aria-label="Abrir comprobante de transferencia de ${escapeHtml(appointment.customer_name)}"><span>Ver comprobante de transferencia</span></button>`
      : '';
    const canVerifyTransfer = appointment.transfer_payment_required
      && appointment.transfer_proof_path
      && ['pending', 'accepted'].includes(appointment.status);
    const isDeposit = appointment.deposit_amount_due < appointment.quoted_amount;
    const transferLabel = isDeposit ? 'anticipo' : 'pago total';
    const transferVerification = canVerifyTransfer
      ? `<div class="transfer-verification-controls ${appointment.transfer_verification_status === 'verified' ? 'verified' : ''}"><strong>${appointment.deposit_amount_due < appointment.quoted_amount ? 'Verificación de anticipo' : 'Verificación de pago total'} · ${transferVerificationLabel(appointment.transfer_verification_status)}</strong>${appointment.transfer_verification_status === 'verified'
        ? `<span>${isDeposit ? 'Anticipo' : 'Pago total'} confirmado: ${formatCurrency(appointment.deposit_amount_due || appointment.quoted_amount)}. La verificación quedó cerrada.</span>`
        : `<div class="appointment-actions"><button class="accept-button" type="button" data-action="verify-transfer" data-id="${appointment.id}">Confirmar ${transferLabel} recibido</button><button class="reject-button" type="button" data-action="unverify-transfer" data-id="${appointment.id}">No verificado</button></div><span>El cliente verá la confirmación en su enlace y por correo. ${isDeposit ? 'Anticipo' : 'Pago total'} reportado: ${formatCurrency(appointment.deposit_amount_due || appointment.quoted_amount)} de ${formatCurrency(appointment.quoted_amount)}.</span>`}</div>`
      : '';
    const rescheduleOffer = appointment.status === 'accepted'
      ? renderRescheduleOfferForm(appointment)
      : '';
    card.innerHTML = `
      <div class="appointment-main"><div><div class="appointment-time">${formatTime(appointment.appointment_time)}</div><div class="appointment-name">${escapeHtml(appointment.customer_name)}</div><div class="appointment-phone">${escapeHtml(appointment.customer_phone)}</div><div class="appointment-phone">${escapeHtml(appointment.customer_email || 'Sin correo')}</div></div><span class="status-pill ${appointment.status === 'pending' ? 'pending' : 'accepted'}">${statusName(appointment.status)}</span></div>
      <div class="appointment-meta">${appointment.transfer_payment_required
        ? appointment.deposit_amount_due < appointment.quoted_amount ? 'Anticipo por transferencia' : 'Pago total por transferencia'
        : 'Efectivo'} · ${formatBookingDate(appointment.appointment_date)}</div>
      ${staffLabel}${services}${remaining}${delay}${transferNotice}${proofPreview}${transferVerification}${rescheduleOffer}${actions}`;
    container.append(card);
  });
  container.querySelectorAll('[data-action="accept"], [data-action="reject"]').forEach((button) => button.addEventListener('click', updateAppointmentStatus));
  container.querySelectorAll('[data-action="show-finish"]').forEach((button) => button.addEventListener('click', showFinishForm));
  container.querySelectorAll('[data-action="mark-paid"], [data-action="mark-debt"]').forEach((button) => button.addEventListener('click', completeAppointment));
  container.querySelectorAll('[data-action="verify-transfer"], [data-action="unverify-transfer"]').forEach((button) => button.addEventListener('click', updateTransferVerification));
  container.querySelectorAll('[data-action="mark-no-show"]').forEach((button) => button.addEventListener('click', markAppointmentNoShow));
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
async function markAppointmentNoShow(event) {
  const button = event.currentTarget;
  const appointmentCard = button.closest('.appointment-card');
  if (!appointmentCard || !isUuid(appointmentCard.dataset.staffId)) {
    showError($('#admin-error'), 'No se pudo identificar al barbero de esta cita. Recarga el panel e inténtalo de nuevo.');
    return;
  }
  if (!window.confirm('¿Confirmas que el cliente no llegó a esta cita? Se marcará «No llegó» y no se registrará ningún ingreso ni deuda.')) return;
  button.disabled = true;
  ++adminAppointmentsLoadRequest;
  try {
    const { data, error } = await db.rpc('mark_barber_appointment_no_show', {
      p_appointment_id: appointmentCard.dataset.id,
      p_staff_id: appointmentCard.dataset.staffId
    });
    if (error) throw error;
    if (data !== true) throw new Error('Supabase no confirmó el cambio de estado de la cita.');
    appointmentCard.remove();
    const acceptedList = $('#accepted-appointment-list');
    const remainingAppointments = acceptedList.querySelectorAll('.appointment-card').length;
    $('#accepted-count').textContent = remainingAppointments;
    if (!remainingAppointments) {
      acceptedList.innerHTML = '<div class="empty-list">Todavía no tienes citas aceptadas.</div>';
    }
    const refreshed = await loadAdminAppointments();
    if (!refreshed) {
      toast('La cita se marcó «No llegó», pero no se pudo actualizar el panel. Recarga la página.');
      return;
    }
    toast('Cita marcada como «No llegó».');
  } catch (error) {
    showError($('#admin-error'), error.message);
    button.disabled = false;
  }
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
  const noShowAction = `<button class="quiet-button" type="button" data-action="mark-no-show" data-id="${appointmentId}">No llegó</button>`;
  if (!state?.open) {
    return `<div class="appointment-actions"><button class="accept-button" data-action="show-finish" data-id="${appointmentId}">Finalizar cita</button>${noShowAction}</div>`;
  }
  const selectedServices = Array.isArray(appointment.requested_services) ? appointment.requested_services : [];
  const serviceName = selectedServices.map((service) => service.name).join(', ');
  const serviceTotal = Number(appointment.quoted_amount) || selectedServices.reduce((sum, service) => sum + Number(service.price), 0);
  const transferPaid = appointment.transfer_payment_required
    && appointment.transfer_verification_status === 'verified'
    ? Math.min(Number(appointment.deposit_amount_due) || 0, serviceTotal)
    : 0;
  const partialTransferPaid = transferPaid > 0 && transferPaid < serviceTotal;
  const hasUnverifiedTransfer = appointment.transfer_payment_required
    && appointment.transfer_verification_status !== 'verified';
  const enteredTotal = Number(state.amount ?? serviceTotal);
  const total = Number.isSafeInteger(enteredTotal) && enteredTotal > 0 ? enteredTotal : serviceTotal;
  const balanceDue = Math.max(0, total - transferPaid);
  return `<div class="appointment-actions">
    ${noShowAction}
    <form class="finish-form" data-id="${appointmentId}">
      <p class="form-note">Servicios: ${escapeHtml(serviceName || 'Sin servicios registrados')} · Total estimado: ${formatCurrency(serviceTotal)}</p>
      ${transferPaid ? `<p class="form-note" data-finish-balance data-prepaid-amount="${transferPaid}" data-prepaid-label="${partialTransferPaid ? 'Anticipo recibido' : 'Pago por transferencia recibido'}">${partialTransferPaid ? 'Anticipo recibido' : 'Pago por transferencia recibido'}: ${formatCurrency(transferPaid)}. ${partialTransferPaid ? `Al finalizar, cobra solo el saldo de ${formatCurrency(Math.max(0, total - transferPaid))}.` : 'No debes cobrarlo de nuevo.'}</p>` : hasUnverifiedTransfer ? `<p class="form-note">${appointment.deposit_amount_due < serviceTotal ? 'Anticipo' : 'Pago total por transferencia'} de ${formatCurrency(appointment.deposit_amount_due)} pendiente de verificación; no se descontará hasta confirmarlo.</p>` : ''}
      <label class="field-label">Total del servicio (COP)
        <input class="finish-amount" type="number" inputmode="numeric" min="1" step="1" placeholder="Ej. 25000" value="${escapeHtml(String(state.amount ?? serviceTotal))}" required>
      </label>
      <div class="appointment-actions">
        <button class="accept-button" type="button" data-action="mark-paid" data-finish-paid-button data-id="${appointmentId}">${transferPaid ? balanceDue ? 'Pagó saldo · finalizar' : 'Finalizar · ya pagado' : 'Pagó · finalizar'}</button>
        <button class="debt-button" type="button" data-action="mark-debt" data-finish-debt-button data-id="${appointmentId}" ${transferPaid && !balanceDue ? 'disabled' : ''}>Registrar como deuda</button>
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
  const form = input.closest('.finish-form');
  const state = finishFormStates.get(form.dataset.id);
  if (state) state.amount = input.value;
  const balanceNote = form.querySelector('[data-finish-balance]');
  if (balanceNote) {
    const prepaidAmount = Number(balanceNote.dataset.prepaidAmount) || 0;
    const prepaidLabel = balanceNote.dataset.prepaidLabel || 'Pago por transferencia recibido';
    const serviceTotal = Number(input.value);
    const paidButton = form.querySelector('[data-finish-paid-button]');
    const debtButton = form.querySelector('[data-finish-debt-button]');
    if (!Number.isSafeInteger(serviceTotal) || serviceTotal <= 0) {
      balanceNote.textContent = 'Ingresa un total válido para calcular el saldo pendiente.';
      if (paidButton) paidButton.disabled = true;
      if (debtButton) debtButton.disabled = true;
      return;
    }
    const balanceDue = Math.max(0, serviceTotal - prepaidAmount);
    balanceNote.textContent = balanceDue
      ? `${prepaidLabel}: ${formatCurrency(prepaidAmount)}. Al finalizar, cobra solo el saldo de ${formatCurrency(balanceDue)}.`
      : `${prepaidLabel}: ${formatCurrency(prepaidAmount)}. No debes cobrarlo de nuevo.`;
    if (paidButton) {
      paidButton.disabled = false;
      paidButton.textContent = balanceDue ? 'Pagó saldo · finalizar' : 'Finalizar · ya pagado';
    }
    if (debtButton) debtButton.disabled = balanceDue === 0;
  }
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
    transfer_payment_required: card.dataset.transferPaymentRequired === 'true',
    transfer_verification_status: card.dataset.transferVerificationStatus,
    transfer_proof_path: card.dataset.transferProofPath,
    transfer_proof_url: card.dataset.transferProofUrl,
    deposit_amount_due: Number(card.dataset.depositAmountDue) || 0,
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
  const depositPaid = appointmentCard.dataset.transferPaymentRequired === 'true'
    && appointmentCard.dataset.transferVerificationStatus === 'verified'
    ? Math.min(Number(appointmentCard.dataset.depositAmountDue) || 0, amount)
    : 0;
  const alreadyPaidLabel = Number(appointmentCard.dataset.depositAmountDue) < amount
    ? 'anticipo por transferencia'
    : 'pago total por transferencia';
  const balanceDue = Math.max(0, amount - depositPaid);
  if (!paid && balanceDue === 0) {
    showError($('#admin-error'), 'El pago verificado ya cubre el total. Finaliza la cita como pagada, sin registrar deuda.');
    return;
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    amountInput.setCustomValidity('Escribe un precio válido, mayor que cero.');
    amountInput.reportValidity();
    return;
  }
  amountInput.setCustomValidity('');
  const confirmation = paid
    ? `¿Confirmas que la cita quedó pagada y atendida?${depositPaid ? ` Ya recibiste ${formatCurrency(depositPaid)} como ${alreadyPaidLabel}; cobra solo el saldo de ${formatCurrency(balanceDue)}. Total del servicio: ${formatCurrency(amount)}.` : ` Total recibido: ${formatCurrency(amount)}.`}`
    : `¿Finalizar la cita y registrar una deuda de ${formatCurrency(balanceDue)}?${depositPaid ? ` Ya recibiste ${formatCurrency(depositPaid)} como ${alreadyPaidLabel}. Total del servicio: ${formatCurrency(amount)}.` : ''}`;
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
  $('#appointment-date').value = today;
  $('#admin-date').value = today;
  $('#admin-date').min = today;
  $('#delay-date').value = today;
  $('#delay-date').min = today;
  $('#schedule-date').value = today;
  configureScheduleDateRange();
  configureAdminWeekRange();
  bookingWeekStart = getWeekStart(today);
  renderBookingWeekPicker();
  $('#break-date').value = today;
  $('#break-date').min = today;
  $('#break-date').max = bookingWeekLimit().maxDate;
  createTwelveHourPicker($('#schedule-open-time'));
  createTwelveHourPicker($('#schedule-close-time'));
  $('#booking-prev-week').addEventListener('click', () => {
    selectBookingWeek(bookingWeekLimit().currentWeekStart);
    loadSlots();
  });
  $('#booking-next-week').addEventListener('click', () => {
    const limits = bookingWeekLimit();
    if (!limits.nextWeekAllowed) return;
    selectBookingWeek(shiftDate(limits.currentWeekStart, 7));
    loadSlots();
  });
  $('#booking-next-step').addEventListener('click', advanceBookingStep);
  $('#booking-prev-step').addEventListener('click', () => {
    setBookingStep('details');
    $('#booking-step-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#booking-form').addEventListener('submit', submitBooking);
  $('#payment-method').addEventListener('change', updateTransferTimingVisibility);
  $('#open-navigation-guide').addEventListener('click', openNavigationGuide);
  document.querySelectorAll('[data-open-navigation-guide]').forEach((button) => {
    button.addEventListener('click', openNavigationGuide);
  });
  $('#close-navigation-guide').addEventListener('click', () => $('#navigation-guide-dialog').close());
  $('#navigation-guide-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $('#close-transfer-dialog').addEventListener('click', () => $('#transfer-details-dialog').close());
  $('#close-transfer-proof-dialog').addEventListener('click', () => $('#transfer-proof-dialog').close());
  $('#minimize-transfer-proof-dialog').addEventListener('click', () => $('#transfer-proof-dialog').close());
  $('#close-public-gallery-dialog').addEventListener('click', () => $('#public-gallery-dialog').close());
  $('#public-gallery-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.addEventListener('click', (event) => {
    const previewButton = event.target.closest('[data-view-transfer-proof]');
    if (!previewButton) return;
    const dialog = $('#transfer-proof-dialog');
    $('#transfer-proof-dialog-image').src = previewButton.dataset.viewTransferProof;
    dialog.showModal();
  });
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
    configureScheduleDateRange();
    loadScheduleEditor();
  });
  $('#schedule-date').addEventListener('change', loadScheduleEditor);
  $('#break-date').addEventListener('change', () => {
    $('#break-date').max = bookingWeekLimit().maxDate;
    loadBreaks($('#break-date').value);
  });
  $('#save-schedule').addEventListener('click', saveSchedule);
  $('#save-slot-duration').addEventListener('click', saveSlotDuration);
  $('#save-transfer-details').addEventListener('click', saveTransferDetails);
  $('#public-gallery-files').addEventListener('change', addPublicGalleryFiles);
  $('#save-public-gallery').addEventListener('click', savePublicGallery);
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
    if ($('#calendar-next-week').disabled) return;
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
  $('#dashboard').addEventListener('click', (event) => {
    const moreButton = event.target.closest('[data-dashboard-more]');
    if (moreButton && $('#dashboard').contains(moreButton)) {
      const menu = $('#dashboard-more-menu');
      const expanded = moreButton.getAttribute('aria-expanded') === 'true';
      menu.classList.toggle('hidden', expanded);
      moreButton.setAttribute('aria-expanded', String(!expanded));
      return;
    }
    const button = event.target.closest('[data-dashboard-section]');
    if (button && $('#dashboard').contains(button)) setDashboardSection(button.dataset.dashboardSection);
  });
  $('#add-transfer-method').addEventListener('click', () => addTransferMethod());
  $('#add-service').addEventListener('click', addService);
  $('#admin-staff').addEventListener('change', async (event) => {
    adminStaffId = event.currentTarget.value;
    setDashboardStatsLoading(true);
    try {
      loadSelectedStaffSettings();
      await refreshSelectedStaff();
    } catch (error) {
      showError($('#admin-error'), error.message);
    } finally {
      setDashboardStatsLoading(false);
    }
  });
  $('#booking-staff').addEventListener('change', () => {
    staffSlugRoute = $('#booking-staff').value || null;
    selectedTime = null;
    $('#selected-slot-summary').classList.add('hidden');
    $('#slots').replaceChildren();
    setBookingServicesForStaff();
    renderBookingServices();
    renderBookingServiceTotal();
    const url = new URL('./', window.location.href);
    if (barberSlug) url.searchParams.set('barber', barberSlug);
    if (staffSlugRoute) url.searchParams.set('staff', staffSlugRoute);
    history.replaceState({}, '', url);
    if (!$('#booking-step-schedule').classList.contains('hidden') && $('#appointment-date').value) loadSlots();
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
