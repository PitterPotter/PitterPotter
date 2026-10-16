import { useState, FormEvent } from 'react';
import { Lock, User } from 'lucide-react';
import { Staff } from '../types';

interface AdminLoginProps {
  onLogin: (staff: Staff) => void;
}

export default function AdminLoginView({ onLogin }: AdminLoginProps) {
 const [username, setUsername] = useState('');
 const [password, setPassword] = useState('');
 const [error, setError] = useState('');

 const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('Please enter username and password');
      return;
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        setError(data.error || 'Invalid credentials');
        return;
      }

      const staff: Staff = {
        id: data.id,
        name: data.name,
        username: data.username,
        passwordHash: '',
        role: data.role,
        canUpdateStatus: !!data.canUpdateStatus,
        canEditBookings: !!data.canEditBookings,
        canAddWalkIns: !!data.canAddWalkIns,
        canDeleteBookings: !!data.canDeleteBookings,
        canEposRefunds: !!data.canEposRefunds,
        canEposDiscounts: !!data.canEposDiscounts,
        canEposManageProducts: !!data.canEposManageProducts,
        allowedStudios: Array.isArray(data.allowedStudios) && data.allowedStudios.length > 0
          ? data.allowedStudios as ('Putney' | 'Wimbledon')[]
          : undefined,
        sessionToken: data.sessionToken,
        sessionExpiresAt: data.sessionExpiresAt,
        createdAt: new Date().toISOString(),
      };

      onLogin(staff);
      return;
    } catch (err) {
      console.error('Staff login failed:', err);
      setError('Login failed');
    }
  };

 return (
 <div className="min-h-screen flex items-center justify-center bg-[#FFFFFF] p-4">
 <div className="bg-white p-8 border border-[#1B2D3C]/20 max-w-md w-full space-y-6">
 <div className="text-center space-y-2">
 <h1 className="font-heading text-3xl font-black text-[#1B2D3C]">Admin Login</h1>
 <p className="text-xs text-stone-500 font-semibold">Pitter Potter Booking Management</p>
 </div>

 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-1.5">
 <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider">
 Username
 </label>
 <div className="relative">
 <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
 <input
 type="text"
 value={username}
 onChange={(e) => setUsername(e.target.value)}
 className="w-full pl-10 pr-3 py-2.5 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
 placeholder="Enter username"
 />
 </div>
 </div>

 <div className="space-y-1.5">
 <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider">
 Password
 </label>
 <div className="relative">
 <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
 <input
 type="password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 className="w-full pl-10 pr-3 py-2.5 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
 placeholder="Enter password"
 />
 </div>
 </div>

 {error && (
 <p className="text-xs text-red-600 font-bold">{error}</p>
 )}

 <button
 type="submit"
 className="w-full py-3 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest border border-[#1B2D3C]/20 hover:translate-x-[2px] hover:translate-y-[2px] active:translate-x-0 active:translate-y-0 transition-all cursor-pointer"
 >
 Login
 </button>
 </form>
 </div>
 </div>
 );
}
