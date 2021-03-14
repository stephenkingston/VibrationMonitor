raw_row = csvread("record_channel3.csv");
readings_as_column = transpose(raw_row);

sampling_frequency = 1666.67;
time_period = 1/sampling_frequency;
[number_of_readings, no_] = size(readings_as_column);
t = (0:number_of_readings-1)*time_period;

figure(1);
plot(t, raw_row)
figure(2);
plot(t, fft(raw_row))