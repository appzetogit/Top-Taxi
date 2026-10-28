import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Edit2, ImagePlus, MapPin, Plus, Save, Trash2 } from 'lucide-react';
import { adminService } from '../../services/adminService';
import AdminPageHeader from '../../components/ui/AdminPageHeader.jsx';
import { adminCardClass, adminInputClass, adminLabelClass, adminPageContainerClass } from '../../components/ui/adminUi.js';
import TourItineraryEditor from './TourItineraryEditor';
import TourDepartureEditor from './TourDepartureEditor';

const LIST_PATH = '/taxi/admin/pricing/tour-packages';

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const toCsv = (list = []) => (Array.isArray(list) ? list.join('\n') : '');
const fromCsv = (text = '') =>
  String(text || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

const buildDefaultForm = () => ({
  destination: '',
  location: '',
  coverImage: '',
  galleryImages: [],
  pricePerPerson: '',
  durationLabel: '',
  ageRangeLabel: '',
  happyTravellersCount: '',
  overview: '',
  highlightsText: '',
  itinerary: [],
  inclusionsText: '',
  exclusionsText: '',
  upcomingDates: [],
  upfrontPayment: { paymentMode: 'full', percentage: 20 },
  status: 'active',
});

const mapPackageToForm = (pkg = {}) => ({
  destination: pkg.destination || '',
  location: pkg.location || '',
  coverImage: pkg.coverImage || '',
  galleryImages: Array.isArray(pkg.galleryImages) ? pkg.galleryImages : [],
  pricePerPerson: pkg.pricePerPerson ?? '',
  durationLabel: pkg.durationLabel || '',
  ageRangeLabel: pkg.ageRangeLabel || '',
  happyTravellersCount: pkg.happyTravellersCount ?? '',
  overview: pkg.overview || '',
  highlightsText: toCsv(pkg.highlights),
  itinerary: Array.isArray(pkg.itinerary) ? pkg.itinerary : [],
  inclusionsText: toCsv(pkg.inclusions),
  exclusionsText: toCsv(pkg.exclusions),
  // Read shape uses `id` per departure row; PATCH/POST expects `_id` -- rename on load.
  upcomingDates: Array.isArray(pkg.upcomingDates)
    ? pkg.upcomingDates.map((d) => ({ ...d, _id: d.id || d._id }))
    : [],
  upfrontPayment: {
    paymentMode: pkg.upfrontPayment?.paymentMode || 'full',
    percentage: pkg.upfrontPayment?.percentage ?? 20,
  },
  status: pkg.status || (pkg.active !== false ? 'active' : 'inactive'),
});

const buildPayload = (form) => ({
  destination: form.destination.trim(),
  location: form.location.trim(),
  coverImage: form.coverImage,
  galleryImages: form.galleryImages.filter(Boolean),
  pricePerPerson: Number(form.pricePerPerson || 0),
  durationLabel: form.durationLabel.trim(),
  ageRangeLabel: form.ageRangeLabel.trim(),
  happyTravellersCount: Number(form.happyTravellersCount || 0),
  overview: form.overview,
  highlights: fromCsv(form.highlightsText),
  itinerary: form.itinerary.map((row) => ({
    day: Number(row.day || 0),
    title: row.title || '',
    description: row.description || '',
  })),
  inclusions: fromCsv(form.inclusionsText),
  exclusions: fromCsv(form.exclusionsText),
  upcomingDates: form.upcomingDates.map((row) => ({
    ...(row._id ? { _id: row._id } : {}),
    startDate: row.startDate,
    endDate: row.endDate,
    totalSeats: Number(row.totalSeats || 0),
    active: row.active !== false,
  })),
  upfrontPayment: {
    paymentMode: form.upfrontPayment.paymentMode,
    percentage: Number(form.upfrontPayment.percentage || 0),
  },
  status: form.status,
});

const TourPackages = ({ mode: propMode }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditor = propMode === 'create' || propMode === 'edit';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [formData, setFormData] = useState(buildDefaultForm);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        const response = await adminService.getTourPackages();
        const results = response?.data?.results || response?.results || [];
        if (!mounted) return;
        setItems(results);

        if (id) {
          const selected = results.find((item) => String(item.id) === String(id));
          if (selected) setFormData(mapPackageToForm(selected));
        } else if (propMode === 'create') {
          setFormData(buildDefaultForm());
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(error?.message || 'Could not load tour packages.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [id, propMode]);

  const updateForm = (field, value) => setFormData((current) => ({ ...current, [field]: value }));

  const handleCoverUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await adminService.uploadImage(dataUrl);
      const url = res?.data?.url || res?.url;
      if (url) updateForm('coverImage', url);
      else toast.error('Upload failed. Please try again.');
    } catch (error) {
      toast.error(error?.message || 'Could not upload cover image.');
    } finally {
      setUploadingCover(false);
      event.target.value = '';
    }
  };

  const handleGalleryUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploadingGallery(true);
    try {
      const urls = [];
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        const res = await adminService.uploadImage(dataUrl);
        const url = res?.data?.url || res?.url;
        if (url) urls.push(url);
      }
      setFormData((current) => ({ ...current, galleryImages: [...current.galleryImages, ...urls] }));
    } catch (error) {
      toast.error(error?.message || 'Could not upload gallery images.');
    } finally {
      setUploadingGallery(false);
      event.target.value = '';
    }
  };

  const removeGalleryImage = (index) => {
    setFormData((current) => ({ ...current, galleryImages: current.galleryImages.filter((_, i) => i !== index) }));
  };

  const totalActive = useMemo(() => items.filter((item) => item.active !== false).length, [items]);

  const handleSave = async () => {
    setErrorMessage('');
    if (!formData.destination.trim()) {
      setErrorMessage('Destination is required');
      return;
    }
    if (!Number(formData.pricePerPerson) || Number(formData.pricePerPerson) <= 0) {
      setErrorMessage('Price per person must be greater than 0');
      return;
    }
    if (formData.upfrontPayment.paymentMode === 'percentage') {
      const pct = Number(formData.upfrontPayment.percentage);
      if (!(pct >= 1 && pct <= 100)) {
        setErrorMessage('Upfront percentage must be between 1 and 100');
        return;
      }
    }

    setIsSaving(true);
    try {
      const payload = buildPayload(formData);
      if (id) {
        await adminService.updateTourPackage(id, payload);
        toast.success('Tour package updated');
      } else {
        await adminService.createTourPackage(payload);
        toast.success('Tour package created');
      }
      navigate(LIST_PATH);
    } catch (error) {
      setErrorMessage(error?.message || 'Could not save tour package.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (packageId) => {
    if (!window.confirm('Delete this tour package?')) return;
    try {
      await adminService.deleteTourPackage(packageId);
      setItems((current) => current.filter((item) => String(item.id) !== String(packageId)));
      toast.success('Tour package removed');
    } catch (error) {
      toast.error(error?.message || 'Could not delete tour package.');
    }
  };

  if (!isEditor) {
    return (
      <div className={adminPageContainerClass}>
        <AdminPageHeader
          module="Price Management"
          page="Tour Packages"
          right={
            <button
              type="button"
              onClick={() => navigate(`${LIST_PATH}/create`)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <Plus size={16} /> Add Tour Package
            </button>
          }
        />

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className={adminCardClass}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total Packages</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{items.length}</p>
          </div>
          <div className={adminCardClass}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Active Packages</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{totalActive}</p>
          </div>
        </div>

        {errorMessage ? (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{errorMessage}</div>
        ) : null}

        {loading ? (
          <div className={adminCardClass}>Loading tour packages...</div>
        ) : items.length === 0 ? (
          <div className={adminCardClass}>No tour packages configured yet.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="grid grid-cols-[minmax(0,1.6fr)_120px_140px_110px_160px] gap-4 border-b border-gray-100 px-6 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">
              <span>Destination</span>
              <span>Price</span>
              <span>Upfront</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-[minmax(0,1.6fr)_120px_140px_110px_160px] gap-4 border-b border-gray-100 px-6 py-4 last:border-b-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-gray-50">
                    {item.coverImage ? (
                      <img src={item.coverImage} alt={item.destination} className="h-full w-full object-cover" />
                    ) : (
                      <MapPin size={18} className="text-gray-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900">{item.destination}</p>
                    <p className="truncate text-xs text-gray-500">{item.durationLabel || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center text-sm font-semibold text-gray-700">₹{item.pricePerPerson}</div>
                <div className="flex items-center text-sm text-gray-700">
                  {item.upfrontPayment?.paymentMode === 'percentage'
                    ? `${item.upfrontPayment.percentage}%`
                    : 'Full amount'}
                </div>
                <div className="flex items-center">
                  <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${item.active !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {item.active !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`${LIST_PATH}/edit/${item.id}`)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                    title="Edit"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={adminPageContainerClass}>
      <AdminPageHeader
        module="Price Management"
        page={id ? 'Edit Tour Package' : 'Create Tour Package'}
        backTo={LIST_PATH}
      />

      {errorMessage ? (
        <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{errorMessage}</div>
      ) : null}

      <div className="space-y-6">
        <div className={adminCardClass}>
          <h2 className="mb-4 text-lg font-bold text-gray-900">Destination Details</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={adminLabelClass}>Destination *</label>
              <input type="text" value={formData.destination} onChange={(e) => updateForm('destination', e.target.value)} className={adminInputClass} placeholder="Goa" />
            </div>
            <div>
              <label className={adminLabelClass}>Location</label>
              <input type="text" value={formData.location} onChange={(e) => updateForm('location', e.target.value)} className={adminInputClass} placeholder="Goa, India" />
            </div>
            <div>
              <label className={adminLabelClass}>Price Per Person *</label>
              <input type="number" min="0" value={formData.pricePerPerson} onChange={(e) => updateForm('pricePerPerson', e.target.value)} className={adminInputClass} placeholder="9999" />
            </div>
            <div>
              <label className={adminLabelClass}>Duration Label</label>
              <input type="text" value={formData.durationLabel} onChange={(e) => updateForm('durationLabel', e.target.value)} className={adminInputClass} placeholder="9D/8N" />
            </div>
            <div>
              <label className={adminLabelClass}>Age Range Label</label>
              <input type="text" value={formData.ageRangeLabel} onChange={(e) => updateForm('ageRangeLabel', e.target.value)} className={adminInputClass} placeholder="5-60 yrs" />
            </div>
            <div>
              <label className={adminLabelClass}>Happy Travellers Count</label>
              <input type="number" min="0" value={formData.happyTravellersCount} onChange={(e) => updateForm('happyTravellersCount', e.target.value)} className={adminInputClass} placeholder="500" />
            </div>
          </div>
        </div>

        <div className={adminCardClass}>
          <h2 className="mb-4 text-lg font-bold text-gray-900">Media</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={adminLabelClass}>Cover Image</label>
              <div className="rounded-xl border border-dashed border-gray-300 p-4">
                <div className="mb-3 flex h-40 items-center justify-center overflow-hidden rounded-lg bg-gray-50">
                  {formData.coverImage ? (
                    <img src={formData.coverImage} alt="Cover" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus size={24} className="text-gray-400" />
                  )}
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700">
                  {uploadingCover ? 'Uploading...' : 'Upload cover image'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} disabled={uploadingCover} />
                </label>
              </div>
            </div>
            <div>
              <label className={adminLabelClass}>Gallery Images</label>
              <div className="rounded-xl border border-dashed border-gray-300 p-4">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700">
                  {uploadingGallery ? 'Uploading...' : 'Add gallery images'}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryUpload} disabled={uploadingGallery} />
                </label>
                {formData.galleryImages.length ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {formData.galleryImages.map((img, index) => (
                      <div key={`${img}-${index}`} className="relative overflow-hidden rounded-lg bg-gray-50">
                        <img src={img} alt={`Gallery ${index + 1}`} className="h-20 w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeGalleryImage(index)}
                          className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-rose-600"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className={adminCardClass}>
          <h2 className="mb-4 text-lg font-bold text-gray-900">Trip Details</h2>
          <div className="space-y-4">
            <div>
              <label className={adminLabelClass}>Overview</label>
              <textarea rows={4} value={formData.overview} onChange={(e) => updateForm('overview', e.target.value)} className={adminInputClass} placeholder="Describe the trip" />
            </div>
            <div>
              <label className={adminLabelClass}>Highlights (one per line)</label>
              <textarea rows={3} value={formData.highlightsText} onChange={(e) => updateForm('highlightsText', e.target.value)} className={adminInputClass} placeholder={'Beaches\nNightlife\nWater sports'} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={adminLabelClass}>Inclusions (one per line)</label>
                <textarea rows={4} value={formData.inclusionsText} onChange={(e) => updateForm('inclusionsText', e.target.value)} className={adminInputClass} placeholder={'Hotel stay\nBreakfast'} />
              </div>
              <div>
                <label className={adminLabelClass}>Exclusions (one per line)</label>
                <textarea rows={4} value={formData.exclusionsText} onChange={(e) => updateForm('exclusionsText', e.target.value)} className={adminInputClass} placeholder={'Airfare\nPersonal expenses'} />
              </div>
            </div>
          </div>
        </div>

        <div className={adminCardClass}>
          <h2 className="mb-4 text-lg font-bold text-gray-900">Itinerary</h2>
          <TourItineraryEditor value={formData.itinerary} onChange={(value) => updateForm('itinerary', value)} />
        </div>

        <div className={adminCardClass}>
          <h2 className="mb-4 text-lg font-bold text-gray-900">Upcoming Dates</h2>
          <TourDepartureEditor value={formData.upcomingDates} onChange={(value) => updateForm('upcomingDates', value)} />
        </div>

        <div className={adminCardClass}>
          <h2 className="mb-4 text-lg font-bold text-gray-900">Upfront Payment</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={adminLabelClass}>Payment Mode</label>
              <select
                value={formData.upfrontPayment.paymentMode}
                onChange={(e) => updateForm('upfrontPayment', { ...formData.upfrontPayment, paymentMode: e.target.value })}
                className={adminInputClass}
              >
                <option value="full">Full amount</option>
                <option value="percentage">Percentage</option>
              </select>
            </div>
            {formData.upfrontPayment.paymentMode === 'percentage' ? (
              <div>
                <label className={adminLabelClass}>Upfront Percentage</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={formData.upfrontPayment.percentage}
                  onChange={(e) => updateForm('upfrontPayment', { ...formData.upfrontPayment, percentage: Number(e.target.value || 0) })}
                  className={adminInputClass}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className={adminCardClass}>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={formData.status === 'active'}
                onChange={(e) => updateForm('status', e.target.checked ? 'active' : 'inactive')}
                className="h-4 w-4 rounded border-gray-300"
              />
              Active tour package
            </label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => navigate(LIST_PATH)} className="text-sm font-medium text-gray-500 hover:text-gray-700">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || loading}
                className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : id ? 'Update Package' : 'Create Package'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TourPackages;
