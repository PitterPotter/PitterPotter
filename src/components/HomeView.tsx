import { motion } from 'motion/react';
import { MapPin, Phone, Clock, ArrowRight } from 'lucide-react';
import { Page } from '../types';
import { Images } from '../images';
import EditableText from './EditableText';
import EditableImage from './EditableImage';

interface HomeViewProps {
  adminMode?: boolean;
 setCurrentPage: (page: Page) => void;
 setVisitPreset?: (preset: { paintersCount: number; itemId: string }) => void;
 disabledPages?: Set<string>;
}

const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const DAY_LABELS: Record<(typeof WEEK_DAYS)[number], string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

const DEFAULT_OPENING_HOURS: Record<'putney' | 'wimbledon', Record<(typeof WEEK_DAYS)[number], string>> = {
  putney: {
    monday: 'Closed (except school holidays)',
    tuesday: '10am – 6pm', wednesday: '10am – 6pm', thursday: '10am – 6pm',
    friday: '10am – 6pm', saturday: '10am – 6pm', sunday: '10am – 6pm',
  },
  wimbledon: {
    monday: 'Closed (except school holidays)',
    tuesday: '10am – 6pm', wednesday: '10am – 6pm',
    thursday: '10am – 9pm', friday: '10am – 9pm', saturday: '10am – 9pm',
    sunday: '10am – 6:30pm',
  },
};

// One row per day, times right-aligned, today highlighted. Every value
// stays inline-editable in admin mode via EditableText.
function StudioHours({ studio, adminMode }: { studio: 'putney' | 'wimbledon'; adminMode: boolean }) {
  const todayIdx = (new Date().getDay() + 6) % 7; // 0=Monday … 6=Sunday
  return (
    <table className="text-xs w-full">
      <tbody>
        {WEEK_DAYS.map((day, i) => {
          const isToday = i === todayIdx;
          return (
            <tr key={day}>
              <td className={`py-1 pr-3 ${isToday ? 'text-[#1B2D3C] font-bold' : 'text-[#1B2D3C]/80'}`}>
                {DAY_LABELS[day]}
                {isToday && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5 align-middle">Today</span>
                )}
              </td>
              <td className="py-1 text-right">
                <EditableText
                  contentKey={`${studio}_hours_${day}`}
                  page="home"
                  defaultValue={DEFAULT_OPENING_HOURS[studio][day]}
                  adminMode={adminMode}
                  className={`text-xs ${isToday ? 'text-[#1B2D3C] font-bold' : 'text-[#1B2D3C]/60'}`}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function HomeView({ setCurrentPage, adminMode = false, disabledPages = new Set() }: HomeViewProps) {
 return (
 <div id="home-view" className="space-y-16 pb-20">
 {/* Hero Banner Section */}
 <section className="relative min-h-[80vh] flex items-center overflow-hidden bg-[#FFFFFF]">
 <EditableImage
 contentKey="hero_image"
 page="home"
 defaultSrc={Images.studioHero}
 alt="Pitter Potter Ceramic Studio"
 className="absolute inset-0 w-full h-full object-cover opacity-90 rounded-lg"
 adminMode={adminMode}
 />
 <div className="absolute inset-0 bg-gradient-to-r from-[#FFFFFF]/95 via-[#FFFFFF]/70 to-transparent" />
 <div className="relative max-w-7xl mx-auto px-4 sm:px-6 md:px-8 z-10 w-full">
 <motion.div
 initial={{ opacity: 0, y: 25 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.6 }}
 className="max-w-xl md:max-w-2xl text-left bg-[#DBE7E4]/80 backdrop-blur-sm p-6 sm:p-8 rounded-2xl"
 >
 <div className="mb-6">
 <EditableText
 contentKey="hero_title"
 page="home"
 defaultValue="Paint your own Pottery Studio"
 className="font-heading text-xl sm:text-2xl md:text-3xl text-[#1B2D3C] font-light leading-relaxed block"
 adminMode={adminMode}
 />
 <EditableText
 contentKey="hero_locations"
 page="home"
 defaultValue="Putney & Wimbledon"
 className="font-heading text-xl sm:text-2xl md:text-3xl text-[#1B2D3C] font-light leading-relaxed block"
 adminMode={adminMode}
 />
 </div>
 <div className="flex flex-wrap gap-4">
 <button
 onClick={() => setCurrentPage('book')}
 className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-white text-[#1B2D3C] text-sm uppercase tracking-widest hover:bg-[#DBE7E4] transition-all rounded-lg cursor-pointer"
 >
 Book a Session
 </button>
 <button
 onClick={() => setCurrentPage('contact-info')}
 className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-white text-[#1B2D3C] text-sm uppercase tracking-widest hover:bg-[#DBE7E4] transition-all rounded-lg cursor-pointer"
 >
 Contact Us
 </button>
 </div>
 </motion.div>
 </div>
 </section>

 {/* Clean Location Cards */}
 <section className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
 <div
 className="group text-left bg-white p-8 shadow-sm transition-all duration-300 flex flex-col"
 >
 <div className="relative aspect-[4/3] overflow-hidden mb-6">
 <EditableImage
 contentKey="putney_card_image"
 page="home"
 defaultSrc={Images.putneyStudio}
 alt="Pitter Potter Putney Studio"
 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 rounded-lg"
 adminMode={adminMode}
 />
 </div>
 <div className="space-y-4">
 <h2 className="font-heading text-2xl lg:text-3xl tracking-tight text-[#1B2D3C]">
 <EditableText contentKey="putney_card_title" page="home" defaultValue="Putney Studio" adminMode={adminMode} className="font-heading text-2xl lg:text-3xl tracking-tight text-[#1B2D3C]" />
 </h2>
 <p className="card-body text-[#1B2D3C]/80 leading-relaxed">
 <EditableText contentKey="putney_card_desc" page="home" defaultValue="Our bright, airy flagship studio on Upper Richmond Road, perfect for individuals, families, and creative parties." adminMode={adminMode} className="card-body text-[#1B2D3C]/80 leading-relaxed" />
 </p>
 <div className="space-y-2 card-body text-[#1B2D3C]/80">
 <div className="flex items-start gap-2.5">
 <MapPin className="w-4 h-4 text-[#1B2D3C] shrink-0 mt-0.5" />
 <span><EditableText contentKey="putney_card_address" page="home" defaultValue="234 Upper Richmond Road, London, SW15 6TG" adminMode={adminMode} className="text-sm text-[#1B2D3C]/80" /></span>
 </div>
 <div className="flex items-start gap-2.5">
 <Phone className="w-4 h-4 text-[#1B2D3C] shrink-0 mt-0.5" />
 <a href="tel:02087881635" className="text-sm text-[#1B2D3C]/80 hover:text-[#1B2D3C] hover:underline">
 <EditableText contentKey="putney_card_phone" page="home" defaultValue="020 8788 1635" adminMode={adminMode} className="text-sm text-[#1B2D3C]/80" />
 </a>
 </div>
 <div className="flex items-start gap-2.5">
 <Clock className="w-4 h-4 text-[#1B2D3C] shrink-0 mt-0.5" />
 <StudioHours studio="putney" adminMode={adminMode} />
 </div>
 </div>
 <button
 onClick={() => setCurrentPage('putney')}
 className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[#1B2D3C] pt-2 hover:text-[#1B2D3C]/80 cursor-pointer"
 >
 View Studio <ArrowRight className="w-4 h-4" />
 </button>
 </div>
 </div>

 <div
 className="group text-left bg-white p-8 shadow-sm transition-all duration-300 flex flex-col"
 >
 <div className="relative aspect-[4/3] overflow-hidden mb-6">
 <EditableImage
 contentKey="wimbledon_card_image"
 page="home"
 defaultSrc={Images.wimbledonStudio}
 alt="Pitter Potter Wimbledon Studio"
 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 rounded-lg"
 adminMode={adminMode}
 />
 </div>
 <div className="space-y-4">
 <h2 className="font-heading text-2xl lg:text-3xl tracking-tight text-[#1B2D3C]">
 <EditableText contentKey="wimbledon_card_title" page="home" defaultValue="Wimbledon Studio" adminMode={adminMode} className="font-heading text-2xl lg:text-3xl tracking-tight text-[#1B2D3C]" />
 </h2>
 <p className="card-body text-[#1B2D3C]/80 leading-relaxed">
 <EditableText contentKey="wimbledon_card_desc" page="home" defaultValue="Our cozy, high-street location on Wimbledon Hill Road, ideal for baby prints and friendly gatherings." adminMode={adminMode} className="card-body text-[#1B2D3C]/80 leading-relaxed" />
 </p>
 <div className="space-y-2 card-body text-[#1B2D3C]/80">
 <div className="flex items-start gap-2.5">
 <MapPin className="w-4 h-4 text-[#1B2D3C] shrink-0 mt-0.5" />
 <span><EditableText contentKey="wimbledon_card_address" page="home" defaultValue="52 Wimbledon Hill Road, London, SW19 7PA" adminMode={adminMode} className="text-sm text-[#1B2D3C]/80" /></span>
 </div>
 <div className="flex items-start gap-2.5">
 <Phone className="w-4 h-4 text-[#1B2D3C] shrink-0 mt-0.5" />
 <a href="tel:02037704499" className="text-sm text-[#1B2D3C]/80 hover:text-[#1B2D3C] hover:underline">
 <EditableText contentKey="wimbledon_card_phone" page="home" defaultValue="020 3770 4499" adminMode={adminMode} className="text-sm text-[#1B2D3C]/80" />
 </a>
 </div>
 <div className="flex items-start gap-2.5">
 <Clock className="w-4 h-4 text-[#1B2D3C] shrink-0 mt-0.5" />
 <StudioHours studio="wimbledon" adminMode={adminMode} />
 </div>
 </div>
 <button
 onClick={() => setCurrentPage('wimbledon')}
 className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[#1B2D3C] pt-2 hover:text-[#1B2D3C]/80 cursor-pointer"
 >
 View Studio <ArrowRight className="w-4 h-4" />
 </button>
 </div>
 </div>
 </div>
 </section>

 {/* What We Do */}
 <section className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
 <div className="text-center md:text-left space-y-2 mb-8">
 <h2 className="font-heading text-3xl md:text-4xl tracking-tight text-[#1B2D3C]">
 <EditableText contentKey="what_we_do_heading" page="home" defaultValue="What We Do" adminMode={adminMode} className="font-heading text-3xl md:text-4xl tracking-tight text-[#1B2D3C]" />
 </h2>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
 {[
 { keyPrefix: 'paint', title: 'Pottery Painting', desc: 'Choose from 150+ shapes and paint with premium glazes.', image: Images.potteryGallery, page: 'pottery-painting' as Page },
 { keyPrefix: 'baby', title: 'Baby Prints', desc: 'Capture tiny hand and foot impressions in clay keepsakes.', image: Images.clayImprint, page: 'baby-prints' as Page },
 { keyPrefix: 'parties', title: 'Parties & Events', desc: 'Birthdays, hen parties, baby showers and corporate groups.', image: Images.birthdayParties, page: 'parties' as Page },
 { keyPrefix: 'sip', title: 'Sip & Paint', desc: 'Paint pottery with a glass in hand — relaxed evenings for adults.', image: Images.potteryGallery, page: 'sip-and-paint' as Page },
 { keyPrefix: 'giftcards', title: 'Gift Cards', desc: 'Give the gift of creativity with a Pitter Potter gift card.', image: Images.potteryGallery, page: 'buy-gift-card' as Page },
 ].filter(item => !item.page || !disabledPages.has(item.page) || adminMode).map((item) => (
 <div
 key={item.keyPrefix}
 onClick={() => item.page && setCurrentPage(item.page)}
 className={`text-left bg-white shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col ${item.page ? 'cursor-pointer' : ''}`}
 >
 <div className="p-6">
 <h3 className="font-heading text-lg tracking-tight text-[#1B2D3C] mb-2">
 <EditableText contentKey={`${item.keyPrefix}_title`} page="home" defaultValue={item.title} adminMode={adminMode} className="font-heading text-lg tracking-tight text-[#1B2D3C]" />
 </h3>
 </div>
 <div className="relative aspect-[4/3] overflow-hidden">
 <EditableImage
 contentKey={`${item.keyPrefix}_image`}
 page="home"
 defaultSrc={item.image}
 alt={item.title}
 className="w-full h-full object-cover rounded-lg"
 adminMode={adminMode}
 />

 </div>
 <div className="p-6 flex-1">
 <p className="card-body text-[#1B2D3C] leading-relaxed">
 <EditableText contentKey={`${item.keyPrefix}_desc`} page="home" defaultValue={item.desc} adminMode={adminMode} className="card-body text-[#1B2D3C] leading-relaxed" />
 </p>
 </div>
 </div>
 ))}
 </div>
 </section>

 </div>
 );
}
