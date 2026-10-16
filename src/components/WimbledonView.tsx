import { useState, useEffect } from 'react';
import { Images } from '../images';
import { Page } from '../types';
import { format } from 'date-fns';
import {Clock, Calendar as CalendarIcon, ArrowRight} from 'lucide-react';
import { loadClosuresFromSupabase, getClosureDates, ClosureDates, isDateInHolidayRange } from '../lib/closures';
import EditableText from './EditableText';
import EditableImage from './EditableImage';
import LocationGallery from './LocationGallery';

interface WimbledonViewProps {
  setCurrentPage: (page: Page) => void;
  adminMode?: boolean;
}

const BASE_OPENING_HOURS = [
  { day: 'Tuesday', time: '10:00am - 6:00pm' },
  { day: 'Wednesday', time: '10:00am - 6:00pm' },
  { day: 'Thursday', time: '10:00am - 9:00pm' },
  { day: 'Friday', time: '10:00am - 9:00pm' },
  { day: 'Saturday', time: '10:00am - 9:00pm' },
  { day: 'Sunday', time: '10:00am - 6:30pm' },
];


export default function WimbledonView({ setCurrentPage, adminMode = false }: WimbledonViewProps) {
  const [closures, setClosures] = useState<ClosureDates>(getClosureDates());

  useEffect(() => {
    loadClosuresFromSupabase().then(setClosures);
  }, []);

  return (
    <div className="min-h-screen bg-[#FFFFFF]">
      {/* Hero Section */}
      <section className="relative h-[60vh] overflow-hidden">
        <EditableImage
          contentKey="wimbledon_hero_image"
          page="wimbledon"
          defaultSrc={Images.wimbledonStudio}
          alt="Pitter Potter Wimbledon Studio Exterior"
          className="w-full h-full object-cover rounded-lg"
          adminMode={adminMode}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2D3C]/40 via-[#1B2D3C]/20 to-[#1B2D3C]/60" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-[#1B2D3C] px-4 bg-[#DBE7E4]/80 backdrop-blur-sm p-6 sm:p-8 rounded-2xl">
            <EditableImage
              contentKey="wimbledon_hero_logo"
              page="wimbledon"
              defaultSrc={Images.logo}
              alt="Pitter Potter Logo"
              className="h-16 sm:h-20 w-auto object-contain mx-auto mb-4"
              adminMode={adminMode}
            />
            <p className="text-xl md:text-2xl font-light text-[#1B2D3C]">
              <EditableText contentKey="wimbledon_subtitle" page="wimbledon" defaultValue="Wimbledon SW19" adminMode={adminMode} className="text-xl md:text-2xl font-light text-[#1B2D3C]" />
            </p>
          </div>
        </div>
      </section>

      {/* Content Section */}
      <section className="max-w-4xl mx-auto px-4 pt-16 -mt-20 relative z-10">
        <div className="bg-white shadow-sm p-8 md:p-12 space-y-8">
          <LocationGallery location="wimbledon" defaultImages={Images.wimbledonGallery} adminMode={adminMode} />
          <div className="space-y-4">
            <EditableText contentKey="wimbledon_title" page="wimbledon" defaultValue="Our Wimbledon Studio" adminMode={adminMode} className="font-heading text-3xl font-black text-[#1B2D3C] block" />
            <EditableText contentKey="wimbledon_description" page="wimbledon" defaultValue="Our cozy, high-street studio on Wimbledon Hill Road, ideal for baby prints, friendly gatherings, and relaxed creative sessions." adminMode={adminMode} className="text-[#1B2D3C] text-sm md:text-base leading-relaxed font-medium" />
          </div>

                    {/* Book a Session CTA */}
          <div className="border-t border-[#1B2D3C]/10 pt-6 space-y-4">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-[#1B2D3C]" />
              <h3 className="font-heading text-xl font-black text-[#1B2D3C]">
                <EditableText contentKey="wimbledon_book_heading" page="wimbledon" defaultValue="Book a Session" adminMode={adminMode} className="font-heading text-xl text-[#1B2D3C]" />
              </h3>
            </div>
            <p className="text-sm text-[#1B2D3C]/80 font-medium">
              <EditableText contentKey="wimbledon_book_description" page="wimbledon" defaultValue="Choose from Pottery Painting, Baby Prints, Sip & Paint, and more — all in one place." adminMode={adminMode} className="text-sm text-[#1B2D3C]/80" />
            </p>
            <button
              onClick={() => { localStorage.setItem('pp_book_studio', 'Wimbledon'); setCurrentPage('book'); }}
              className="w-full py-3.5 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest hover:bg-[#D6E2E9] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <EditableText contentKey="wimbledon_book_button" page="wimbledon" defaultValue="Book at Wimbledon" adminMode={adminMode} className="text-xs uppercase tracking-widest" /> <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="border-t border-[#1B2D3C]/10 pt-8 space-y-6">
            <h3 className="font-heading text-2xl font-black text-[#1B2D3C]">
              <EditableText contentKey="wimbledon_contact_heading" page="wimbledon" defaultValue="Contact & Location" adminMode={adminMode} className="font-heading text-2xl text-[#1B2D3C]" />
            </h3>

            <div className="aspect-video w-full bg-[#D6E2E9]/50 overflow-hidden rounded-lg">
              <iframe
                title="Wimbledon Studio Location"
                src="https://maps.google.com/maps?q=Pitter+Potter+Wimbledon&z=15&ie=UTF8&iwloc=&output=embed"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>

            <div className="space-y-4 text-sm text-[#1B2D3C] font-semibold">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-[#DBE7E4] flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-[#1B2D3C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-bold"><EditableText contentKey="wimbledon_address_label" page="wimbledon" defaultValue="Address:" adminMode={adminMode} className="text-sm text-[#1B2D3C]" /></p>
                  <p className="text-stone-600"><EditableText contentKey="wimbledon_address" page="wimbledon" defaultValue="52 Wimbledon Hill Road, London, SW19 7PA" adminMode={adminMode} className="text-sm text-stone-600" /></p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-[#DBE7E4] flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-[#1B2D3C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <div>
                  <p className="font-bold"><EditableText contentKey="wimbledon_phone_label" page="wimbledon" defaultValue="Phone:" adminMode={adminMode} className="text-sm text-[#1B2D3C]" /></p>
                  <a href="tel:02037704499" className="text-[#1B2D3C] hover:underline font-bold"><EditableText contentKey="wimbledon_phone" page="wimbledon" defaultValue="020 3770 4499" adminMode={adminMode} className="text-sm text-[#1B2D3C]" /></a>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[#1B2D3C]/10 pt-8 space-y-6">
            <h3 className="font-heading text-2xl font-black text-[#1B2D3C]">
              <EditableText contentKey="wimbledon_hours_heading" page="wimbledon" defaultValue="Opening Hours" adminMode={adminMode} className="font-heading text-2xl text-[#1B2D3C]" />
            </h3>
            <div className="divide-y divide-[#1B2D3C]/10 text-sm text-[#1B2D3C] font-medium">
              {/* Monday — dynamic based on school holidays */}
              {(() => {
                const todayStr = format(new Date(), 'yyyy-MM-dd');
                const mondayOpen = isDateInHolidayRange(todayStr, closures.schoolHolidays);
                const mondayTime = mondayOpen ? '10:00am - 6:00pm' : 'Closed (except school holidays)';
                return (
                  <div className="flex justify-between py-2.5">
                    <span className="font-bold"><EditableText contentKey="wimbledon_hours_monday" page="wimbledon" defaultValue="Monday" adminMode={adminMode} className="text-sm text-[#1B2D3C]" /></span>
                    <span className={mondayOpen ? 'text-emerald-600 font-bold' : 'text-stone-500'}>{mondayTime}</span>
                  </div>
                );
              })()}
              {BASE_OPENING_HOURS.map(({ day, time }, index) => (
                <div key={`${day}-${index}`} className="flex justify-between py-2.5">
                  <span className="font-bold"><EditableText contentKey={`wimbledon_hours_${day.toLowerCase().replace(/[^a-z]/g, '_')}`} page="wimbledon" defaultValue={day} adminMode={adminMode} className="text-sm text-[#1B2D3C]" /></span>
                  <span><EditableText contentKey={`wimbledon_hours_${day.toLowerCase().replace(/[^a-z]/g, '_')}_time`} page="wimbledon" defaultValue={time} adminMode={adminMode} className="text-sm text-[#1B2D3C]" /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
