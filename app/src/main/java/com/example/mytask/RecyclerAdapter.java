package com.example.mytask;

/**
 * Created by Константин on 28.02.2017.
 */

import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.support.v7.app.AlertDialog;
import android.support.v7.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.RelativeLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.HashSet;



public class RecyclerAdapter extends RecyclerView.Adapter<RecyclerAdapter.ViewHolder> {

    private ArrayList<ObjectItem> dataSet=new ArrayList<ObjectItem>();
    private LayoutInflater mLayoutInflater;
    private HashSet<Integer> expendposition;

    Boolean check=false;
    Context mContext;
    public Dbase dHelper;
    public TextView empty_view;
    Context c;
    public RecyclerAdapter (Context context){
        this.mContext=context;
        mLayoutInflater = LayoutInflater.from(context);

    }

    // класс view holder-а с помощью которого мы получаем ссылку на каждый элемент
    // отдельного пункта списка
    public static class ViewHolder extends RecyclerView.ViewHolder {

        public TextView name;
        public TextView timesum;
        RelativeLayout expandable;
        public View v;


        public ViewHolder(View v) {
            super(v);
            this.v=v;
            this.expandable= (RelativeLayout)itemView.findViewById(R.id.expandableLayout);
            this.name = (TextView) v.findViewById(R.id.recycler_name);
            this.timesum = (TextView) v.findViewById(R.id.recycler_timesum);

        }

    }

    // Конструктор
    public RecyclerAdapter(Context c,ArrayList<ObjectItem> data) {
        this.c=c;
        dataSet = data;
        this.expendposition = new HashSet<>();
    }

    // Создает новые views (вызывается layout manager-ом)
    @Override
    public RecyclerAdapter.ViewHolder onCreateViewHolder(ViewGroup parent,
                                                         int viewType) {
        // create a new view
        View view = mLayoutInflater.from(parent.getContext())
                .inflate(R.layout.my_text, parent, false);

        // тут можно программно менять атрибуты лэйаута (size, margins, paddings и др.)
        final ViewHolder vh = new ViewHolder(view);
        view.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if(expendposition.contains(vh.getAdapterPosition()))
                {
                    vh.expandable.setVisibility(View.GONE);
                    expendposition.remove(vh.getAdapterPosition());
                    //  myViewHolder.schedule.setVisibility(View.VISIBLE);

                }
                else {
                    vh.expandable.setVisibility(View.VISIBLE);
                    expendposition.add(vh.getAdapterPosition());
                }
            }

        });

        return vh;
    }

    // Заменяет контент отдельного view (вызывается layout manager-ом)
    @Override
    public void onBindViewHolder(final ViewHolder holder, final int listPosition) {

        TextView name1=holder.name;
        TextView timesum1=holder.timesum;
        name1.setText(dataSet.get(listPosition).getName());
        timesum1.setText(dataSet.get(listPosition).getTimesum());
        holder.v.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(final View v) {
                final String[] item = {"Изменить", "Удалить"};
                AlertDialog.Builder builder = new AlertDialog.Builder(v.getContext());
                        builder.setItems(item, new DialogInterface.OnClickListener() {
                            public void onClick(DialogInterface dialog, int which) {
                                final Intent intent;
                                if (item[which].equals("Изменить")) {
                                    intent =  new Intent(v.getContext(), Change.class);
                                    intent.putExtra("MName",dataSet.get(listPosition).getName());
                                    v.getContext().startActivity(intent);
                                }
                                if (item[which].equals("Удалить")) {
                                    Delete(v);
                                }
                            }
                        });
                AlertDialog dialog = builder.create();
                dialog.show();
                return true;
            }

            public void Delete(View v) {
                dHelper = new Dbase(v.getContext());
                AlertDialog.Builder adb = new AlertDialog.Builder(v.getContext());
                adb.setMessage("Вы действительно хотите удалить "+dataSet.get(listPosition).getName()+" ?");
                // кнопка положительного ответа
                adb.setPositiveButton(R.string.yes, new DialogInterface.OnClickListener(){
                    public void onClick(DialogInterface dialog, int which)
                    {
                        System.out.println("Да");
                        dHelper.deleteItem(dataSet.get(listPosition).getName());
                        dataSet.remove(listPosition);
                        notifyDataSetChanged();
                    }
                });
                // кнопка отрицательного ответа
                adb.setNegativeButton(R.string.no, new DialogInterface.OnClickListener(){
                    public void onClick(DialogInterface dialog, int which)
                    {
                        System.out.println("Нет");
                    };
                });
                // кнопка нейтрального ответа
                adb.setNeutralButton(R.string.cancel, new DialogInterface.OnClickListener(){
                    public void onClick(DialogInterface dialog, int which)
                    {
                        System.out.println("Отмена");
                    };
                });
                AlertDialog dialog = adb.create();
                dialog.show();
            }
        });
    }

    // Возвращает размер данных (вызывается layout manager-ом)
    @Override
    public int getItemCount() {
        return dataSet.size();}
}