begin;

alter table public.inquiry_files add column if not exists product_id uuid;

alter table public.inquiry_files drop constraint if exists inquiry_files_product_id_fkey;
alter table public.inquiry_files add constraint inquiry_files_product_id_fkey
foreign key (product_id) references public.inquiry_items(id) on delete cascade;

alter table public.inquiry_files drop constraint if exists inquiry_files_file_kind_check;
alter table public.inquiry_files add constraint inquiry_files_file_kind_check
check (file_kind in ('client_photo','shared_photo','quote','payment_proof','product_photo','other'));

alter table public.inquiry_files drop constraint if exists inquiry_files_product_photo_link_check;
alter table public.inquiry_files add constraint inquiry_files_product_photo_link_check
check ((file_kind = 'product_photo' and product_id is not null) or (file_kind <> 'product_photo' and product_id is null));

create index if not exists inquiry_files_product_id_idx on public.inquiry_files(product_id);

commit;
