import AdminMealMapPlacesSection from './AdminMealMapPlacesSection.jsx';
import AdminMealMapEditRequestsSection from './AdminMealMapEditRequestsSection.jsx';
import AdminMealMapSettingsSection from './AdminMealMapSettingsSection.jsx';

function AdminMealMapTabSections({ places, edits, settings }) {
  return (
    <>
      <AdminMealMapPlacesSection {...places} />
      <AdminMealMapEditRequestsSection {...edits} />
      <AdminMealMapSettingsSection {...settings} />
    </>
  );
}

export default AdminMealMapTabSections;
